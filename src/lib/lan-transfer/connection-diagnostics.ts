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

const DIAGNOSTIC_STORAGE_KEY = 'winrisef-lan-diagnostics-v1'
const DIAGNOSTIC_SCHEMA_VERSION = 1
const MAX_DIAGNOSTIC_ENTRIES = 1_000
const MAX_DIAGNOSTIC_STORAGE_CHARS = 900_000
const MAX_DETAIL_DEPTH = 4
const MAX_DETAIL_KEYS = 40
const MAX_ARRAY_ITEMS = 50
const MAX_STRING_LENGTH = 600
const SENSITIVE_KEY = /(token|nonce|secret|password|authorization|cookie|credential|invite(?:link)?|room(?:id)?)/i
const IDENTIFIER_KEY = /(?:device|peer|instance|source|attachment|transfer|connection|negotiation)Id$/i
const LONG_HEX = /\b[0-9a-f]{24,}\b/gi
const LONG_SECRET_LIKE = /\b[A-Za-z0-9_-]{48,}\b/g

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

export function shortConnectionId(value: string) {
	return value ? value.slice(0, 8) : '-'
}

export function summarizeIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate | null) {
	const line = candidateLine(candidate)
	const parts = line.trim().split(/\s+/)
	const typeIndex = parts.indexOf('typ')
	const tcpTypeIndex = parts.indexOf('tcptype')
	const address = parts[4] || ''
	return {
		type: typeIndex >= 0 ? parts[typeIndex + 1] || 'unknown' : 'unknown',
		protocol: (parts[2] || 'unknown').toLowerCase(),
		family: address.endsWith('.local') ? 'mdns' : address.includes(':') ? 'ipv6' : /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) ? 'ipv4' : 'unknown',
		tcpType: tcpTypeIndex >= 0 ? parts[tcpTypeIndex + 1] || 'unknown' : undefined,
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
	window.addEventListener('error', onError)
	window.addEventListener('unhandledrejection', onUnhandledRejection)
	window.addEventListener('online', onOnline)
	window.addEventListener('offline', onOffline)
	logLanConnection('DIAGNOSTICS', 'capture-started', diagnosticEnvironment())
	return () => {
		window.removeEventListener('error', onError)
		window.removeEventListener('unhandledrejection', onUnhandledRejection)
		window.removeEventListener('online', onOnline)
		window.removeEventListener('offline', onOffline)
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
	return {
		page: typeof location === 'undefined' ? 'unknown' : `${location.origin}${location.pathname}`,
		userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
		language: typeof navigator === 'undefined' ? 'unknown' : navigator.language,
		online: typeof navigator === 'undefined' ? false : navigator.onLine,
		visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
	}
}

function fileTimestamp(value: Date) {
	const pad = (part: number) => String(part).padStart(2, '0')
	return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`
}
