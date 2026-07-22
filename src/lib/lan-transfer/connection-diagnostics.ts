export type DiagnosticDetails = Record<string, unknown>
export type LanDiagnosticLevel = 'info' | 'warn' | 'error'

export type LanDiagnosticEntry = {
	id: string
	timestamp: string
	level: LanDiagnosticLevel
	scope: string
	event: string
	details: DiagnosticDetails
}

const DIAGNOSTIC_STORAGE_KEY = 'winrisef-lan-diagnostics-v2'
const DIAGNOSTIC_SCHEMA_VERSION = 2
const MAX_DIAGNOSTIC_ENTRIES = 3_000
const MAX_DIAGNOSTIC_STORAGE_CHARS = 3_500_000
const MAX_DETAIL_DEPTH = 4
const MAX_DETAIL_KEYS = 40
const MAX_ARRAY_ITEMS = 50
const MAX_STRING_LENGTH = 600
const SENSITIVE_KEY = /(token|nonce|secret|password|authorization|cookie|credential|invite(?:link)?|room(?:id)?)/i
const IDENTIFIER_KEY = /(?:device|peer|instance|source|attachment|transfer|connection|negotiation)Id$/i
const LONG_HEX = /\b[0-9a-f]{24,}\b/gi
const LONG_SECRET_LIKE = /\b[A-Za-z0-9_-]{48,}\b/g

type PermissionNameWithLna = PermissionName | 'local-network-access'
type NetworkInformationLike = EventTarget & { type?: string; effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }

let initialized = false
let pageLifecycleBound = false
let sequence = 0
let flushTimer: number | null = null
let entries: LanDiagnosticEntry[] = []
const sessionId = createSessionId()

function createSessionId() {
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(4)
		crypto.getRandomValues(bytes)
		return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
	}
	return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

function candidateLine(candidate: RTCIceCandidateInit | RTCIceCandidate | null) {
	return candidate?.candidate || ''
}

export function summarizeNetworkAddress(value: string) {
	const address = value.trim().replace(/^\[|\]$/g, '').split('%', 1)[0] || ''
	if (!address) return { family: 'unknown', addressKind: 'unknown' }
	if (address.toLowerCase().endsWith('.local')) return { family: 'mdns', addressKind: 'mdns' }
	const ipv4 = parseIpv4(address)
	if (ipv4) {
		const [a, b] = ipv4
		if (a === 127) return { family: 'ipv4', addressKind: 'loopback-ipv4' }
		if (a === 169 && b === 254) return { family: 'ipv4', addressKind: 'link-local-ipv4' }
		if (a === 100 && b! >= 64 && b! <= 127) return { family: 'ipv4', addressKind: 'cgnat-ipv4' }
		if (a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)) return { family: 'ipv4', addressKind: 'private-ipv4' }
		return { family: 'ipv4', addressKind: 'public-ipv4' }
	}
	if (!address.includes(':')) return { family: 'unknown', addressKind: 'unknown' }
	const normalized = address.toLowerCase()
	if (normalized === '::1') return { family: 'ipv6', addressKind: 'loopback-ipv6' }
	const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16)
	if ((first & 0xffc0) === 0xfe80) return { family: 'ipv6', addressKind: 'link-local-ipv6' }
	if ((first & 0xfe00) === 0xfc00) return { family: 'ipv6', addressKind: 'ula-ipv6' }
	if ((first & 0xe000) === 0x2000) return { family: 'ipv6', addressKind: 'gua-ipv6' }
	return { family: 'ipv6', addressKind: 'other-ipv6' }
}

export function shortConnectionId(value: string) {
	return value ? value.slice(0, 8) : '-'
}

export function summarizeIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate | null) {
	const line = candidateLine(candidate)
	const parts = line.trim().split(/\s+/)
	const typeIndex = parts.indexOf('typ')
	const tcpTypeIndex = parts.indexOf('tcptype')
	const relatedAddressIndex = parts.indexOf('raddr')
	const relatedPortIndex = parts.indexOf('rport')
	const generationIndex = parts.indexOf('generation')
	const usernameFragmentIndex = parts.indexOf('ufrag')
	const networkIdIndex = parts.indexOf('network-id')
	const networkCostIndex = parts.indexOf('network-cost')
	const address = parts[4] || ''
	const port = parts[5] ? Number(parts[5]) : Number.NaN
	const relatedAddress = relatedAddressIndex >= 0 ? parts[relatedAddressIndex + 1] || '' : ''
	const relatedPortValue = relatedPortIndex >= 0 ? parts[relatedPortIndex + 1] || '' : ''
	const relatedPort = relatedPortValue ? Number(relatedPortValue) : Number.NaN
	const addressSummary = summarizeNetworkAddress(address)
	const relatedAddressSummary = summarizeNetworkAddress(relatedAddress)
	const priority = parts[3] ? Number(parts[3]) : Number.NaN
	const component = parts[1] ? Number(parts[1]) : Number.NaN
	const generationValue = generationIndex >= 0 ? parts[generationIndex + 1] || '' : ''
	const generation = generationValue ? Number(generationValue) : Number.NaN
	const networkIdValue = networkIdIndex >= 0 ? parts[networkIdIndex + 1] || '' : ''
	const networkId = networkIdValue ? Number(networkIdValue) : Number.NaN
	const networkCostValue = networkCostIndex >= 0 ? parts[networkCostIndex + 1] || '' : ''
	const networkCost = networkCostValue ? Number(networkCostValue) : Number.NaN
	return {
		foundation: parts[0]?.replace(/^candidate:/, '') || undefined,
		component: Number.isFinite(component) ? component : undefined,
		priority: Number.isFinite(priority) ? priority : undefined,
		sdpMid: candidate?.sdpMid ?? undefined,
		sdpMLineIndex: candidate?.sdpMLineIndex ?? undefined,
		usernameFragment: candidate?.usernameFragment || (usernameFragmentIndex >= 0 ? parts[usernameFragmentIndex + 1] || undefined : undefined),
		type: typeIndex >= 0 ? parts[typeIndex + 1] || 'unknown' : 'unknown',
		protocol: (parts[2] || 'unknown').toLowerCase(),
		address,
		port: Number.isFinite(port) ? port : undefined,
		family: addressSummary.family,
		addressKind: addressSummary.addressKind,
		relatedAddress: relatedAddress || undefined,
		relatedPort: Number.isFinite(relatedPort) ? relatedPort : undefined,
		relatedAddressKind: relatedAddressSummary.addressKind === 'unknown' ? undefined : relatedAddressSummary.addressKind,
		tcpType: tcpTypeIndex >= 0 ? parts[tcpTypeIndex + 1] || 'unknown' : undefined,
		generation: Number.isFinite(generation) ? generation : undefined,
		networkId: Number.isFinite(networkId) ? networkId : undefined,
		networkCost: Number.isFinite(networkCost) ? networkCost : undefined,
	}
}

export function redactDiagnosticDetails(details: DiagnosticDetails) {
	return sanitizeValue(details, '', 0, new WeakSet()) as DiagnosticDetails
}

export function logLanConnection(scope: string, event: string, details: DiagnosticDetails = {}, level: LanDiagnosticLevel = 'info') {
	const redacted = redactDiagnosticDetails(details)
	console[level](`[LAN][${scope}] ${event}`, redacted)
	recordLanDiagnostic(scope, event, redacted, level)
}

export function installLanDiagnosticCapture() {
	if (typeof window === 'undefined') return () => {}
	initializeDiagnostics()
	const removeLocalNetworkPermissionCapture = installLocalNetworkPermissionCapture()
	const connection = networkInformation()
	const onError = (event: ErrorEvent) => {
		logLanConnection('WEB', 'window-error', {
			message: event.message,
			source: event.filename,
			line: event.lineno,
			column: event.colno,
		}, 'error')
	}
	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		logLanConnection('WEB', 'unhandled-rejection', { error: errorMessage(event.reason) }, 'error')
	}
	const onOnline = () => logLanConnection('WEB', 'network-online')
	const onOffline = () => logLanConnection('WEB', 'network-offline', {}, 'warn')
	const onFocus = () => logLanConnection('WEB', 'window-focus', { visibility: document.visibilityState })
	const onBlur = () => logLanConnection('WEB', 'window-blur', { visibility: document.visibilityState })
	const onPageShow = (event: PageTransitionEvent) => logLanConnection('WEB', 'page-show', { persisted: event.persisted, visibility: document.visibilityState })
	const onVisibilityChange = () => logLanConnection('WEB', 'visibility-change', { visibility: document.visibilityState, focused: document.hasFocus() })
	const onConnectionChange = () => logLanConnection('WEB', 'network-information-change', networkInformationSummary(connection))
	window.addEventListener('error', onError)
	window.addEventListener('unhandledrejection', onUnhandledRejection)
	window.addEventListener('online', onOnline)
	window.addEventListener('offline', onOffline)
	window.addEventListener('focus', onFocus)
	window.addEventListener('blur', onBlur)
	window.addEventListener('pageshow', onPageShow)
	document.addEventListener('visibilitychange', onVisibilityChange)
	connection?.addEventListener('change', onConnectionChange)
	logLanConnection('DIAGNOSTICS', 'capture-started', diagnosticEnvironment())
	return () => {
		window.removeEventListener('error', onError)
		window.removeEventListener('unhandledrejection', onUnhandledRejection)
		window.removeEventListener('online', onOnline)
		window.removeEventListener('offline', onOffline)
		window.removeEventListener('focus', onFocus)
		window.removeEventListener('blur', onBlur)
		window.removeEventListener('pageshow', onPageShow)
		document.removeEventListener('visibilitychange', onVisibilityChange)
		connection?.removeEventListener('change', onConnectionChange)
		removeLocalNetworkPermissionCapture()
		logLanConnection('DIAGNOSTICS', 'capture-stopped')
		flushDiagnostics()
	}
}

export function downloadLanDiagnostics() {
	if (typeof window === 'undefined' || typeof document === 'undefined') return false
	initializeDiagnostics()
	logLanConnection('DIAGNOSTICS', 'export-requested', { entryCount: entries.length })
	flushDiagnostics()
	const exportedEntries = mergeEntries(readStoredEntries(), entries)
	const payload = {
		schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		environment: diagnosticEnvironment(),
		entries: exportedEntries,
	}
	const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = `winrisef-web-diagnostics-${fileTimestamp(new Date())}.json`
	anchor.hidden = true
	document.body.append(anchor)
	anchor.click()
	anchor.remove()
	window.setTimeout(() => URL.revokeObjectURL(url), 0)
	return true
}

function recordLanDiagnostic(scope: string, event: string, details: DiagnosticDetails, level: LanDiagnosticLevel) {
	if (typeof window === 'undefined') return
	initializeDiagnostics()
	entries.push({
		id: `${sessionId}-${String(++sequence).padStart(6, '0')}`,
		timestamp: new Date().toISOString(),
		level,
		scope: scope.slice(0, 40),
		event: event.slice(0, 80),
		details,
	})
	if (entries.length > MAX_DIAGNOSTIC_ENTRIES) entries = entries.slice(-MAX_DIAGNOSTIC_ENTRIES)
	scheduleFlush(level === 'info' ? 250 : 0)
}

function initializeDiagnostics() {
	if (initialized || typeof window === 'undefined') return
	initialized = true
	entries = readStoredEntries()
	if (!pageLifecycleBound) {
		pageLifecycleBound = true
		window.addEventListener('pagehide', flushDiagnostics)
	}
}

function scheduleFlush(delayMs: number) {
	if (flushTimer) clearTimeout(flushTimer)
	flushTimer = window.setTimeout(flushDiagnostics, delayMs)
}

function flushDiagnostics() {
	if (typeof localStorage === 'undefined') return
	if (flushTimer) clearTimeout(flushTimer)
	flushTimer = null
	let merged = mergeEntries(readStoredEntries(), entries)
	try {
		let encoded = JSON.stringify({ version: DIAGNOSTIC_SCHEMA_VERSION, updatedAt: new Date().toISOString(), entries: merged })
		while (encoded.length > MAX_DIAGNOSTIC_STORAGE_CHARS && merged.length > 100) {
			merged = merged.slice(Math.max(1, Math.floor(merged.length * 0.15)))
			encoded = JSON.stringify({ version: DIAGNOSTIC_SCHEMA_VERSION, updatedAt: new Date().toISOString(), entries: merged })
		}
		localStorage.setItem(DIAGNOSTIC_STORAGE_KEY, encoded)
		entries = merged
	} catch {
		entries = merged.slice(-200)
		try {
			localStorage.setItem(DIAGNOSTIC_STORAGE_KEY, JSON.stringify({ version: DIAGNOSTIC_SCHEMA_VERSION, updatedAt: new Date().toISOString(), entries }))
		} catch {}
	}
}

function readStoredEntries() {
	if (typeof localStorage === 'undefined') return []
	try {
		const parsed = JSON.parse(localStorage.getItem(DIAGNOSTIC_STORAGE_KEY) || 'null') as { entries?: unknown } | null
		const storedEntries = parsed?.entries
		return Array.isArray(storedEntries) ? storedEntries.filter(isDiagnosticEntry).slice(-MAX_DIAGNOSTIC_ENTRIES) : []
	} catch {
		return []
	}
}

function isDiagnosticEntry(value: unknown): value is LanDiagnosticEntry {
	if (!value || typeof value !== 'object') return false
	const entry = value as Partial<LanDiagnosticEntry>
	return typeof entry.id === 'string' && typeof entry.timestamp === 'string' && (entry.level === 'info' || entry.level === 'warn' || entry.level === 'error') && typeof entry.scope === 'string' && typeof entry.event === 'string' && Boolean(entry.details) && typeof entry.details === 'object'
}

function mergeEntries(...groups: LanDiagnosticEntry[][]) {
	const merged = new Map<string, LanDiagnosticEntry>()
	for (const group of groups) for (const entry of group) merged.set(entry.id, entry)
	return [...merged.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)).slice(-MAX_DIAGNOSTIC_ENTRIES)
}

function sanitizeValue(value: unknown, key: string, depth: number, seen: WeakSet<object>): unknown {
	if (SENSITIVE_KEY.test(key)) return '[redacted]'
	if (IDENTIFIER_KEY.test(key) && typeof value === 'string') return shortConnectionId(value)
	if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
	if (typeof value === 'string') return sanitizeString(value, key)
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'undefined') return undefined
	if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
	if (depth >= MAX_DETAIL_DEPTH) return '[max-depth]'
	if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message, 'error') }
	if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeValue(item, key, depth + 1, seen))
	if (typeof value === 'object') {
		if (seen.has(value)) return '[circular]'
		seen.add(value)
		const result: DiagnosticDetails = {}
		for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_DETAIL_KEYS)) {
			const sanitized = sanitizeValue(childValue, childKey, depth + 1, seen)
			if (sanitized !== undefined) result[childKey] = sanitized
		}
		seen.delete(value)
		return result
	}
	return String(value)
}

function sanitizeString(value: string, key: string) {
	let sanitized = value.replace(LONG_HEX, '[redacted-hex]').replace(LONG_SECRET_LIKE, '[redacted-secret]')
	if (/url|source/i.test(key)) sanitized = safeUrl(sanitized)
	return sanitized.length > MAX_STRING_LENGTH ? `${sanitized.slice(0, MAX_STRING_LENGTH)}…` : sanitized
}

function safeUrl(value: string) {
	try {
		const url = new URL(value)
		url.username = ''
		url.password = ''
		url.search = ''
		url.hash = ''
		return url.toString()
	} catch {
		return value.split(/[?#]/, 1)[0] || value
	}
}

function errorMessage(value: unknown) {
	return value instanceof Error ? `${value.name}: ${value.message}` : String(value || 'unknown error')
}

function diagnosticEnvironment() {
	const connection = networkInformation()
	return {
		page: typeof location === 'undefined' ? 'unknown' : `${location.origin}${location.pathname}`,
		userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
		language: typeof navigator === 'undefined' ? 'unknown' : navigator.language,
		online: typeof navigator === 'undefined' ? false : navigator.onLine,
		visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
		focused: typeof document === 'undefined' ? false : document.hasFocus(),
		secureContext: typeof window === 'undefined' ? false : window.isSecureContext,
		crossOriginIsolated: typeof window === 'undefined' ? false : window.crossOriginIsolated,
		connection: connection ? networkInformationSummary(connection) : undefined,
	}
}

function networkInformation() {
	return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

function networkInformationSummary(connection: NetworkInformationLike | undefined) {
	return {
		type: connection?.type,
		effectiveType: connection?.effectiveType,
		downlink: connection?.downlink,
		rtt: connection?.rtt,
		saveData: connection?.saveData,
		online: typeof navigator !== 'undefined' && navigator.onLine,
	}
}

function installLocalNetworkPermissionCapture() {
	if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
		logLanConnection('PERMISSION', 'local-network-access', { supported: false, state: 'unsupported' })
		return () => {}
	}
	let disposed = false
	let permission: PermissionStatus | null = null
	const report = () => logLanConnection('PERMISSION', 'local-network-access', {
		supported: true,
		state: permission?.state || 'unknown',
		secureContext: typeof window !== 'undefined' && window.isSecureContext,
	})
	void navigator.permissions.query({ name: 'local-network-access' as PermissionNameWithLna } as PermissionDescriptor).then(status => {
		if (disposed) return
		permission = status
		report()
		permission.addEventListener('change', report)
	}).catch(error => {
		if (!disposed) logLanConnection('PERMISSION', 'local-network-access', {
			supported: false,
			state: 'unsupported',
			error: errorMessage(error),
		}, 'warn')
	})
	return () => {
		disposed = true
		permission?.removeEventListener('change', report)
	}
}

function parseIpv4(value: string) {
	const parts = value.split('.')
	if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part))) return null
	const octets = parts.map(Number)
	return octets.every(octet => octet <= 255) ? octets : null
}

function fileTimestamp(value: Date) {
	const pad = (part: number) => String(part).padStart(2, '0')
	return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`
}
