type DiagnosticDetails = Record<string, unknown>

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

export function logLanConnection(scope: string, event: string, details: DiagnosticDetails = {}, level: 'info' | 'warn' | 'error' = 'info') {
	console[level](`[LAN][${scope}] ${event}`, details)
}
