import type { LanRole } from './types'

export type LanConnectionRoute = {
	family: 'ipv4' | 'ipv6' | 'unknown'
	kind: 'lan' | 'nat' | 'direct' | 'unknown'
}

export function formatLanConnectionRoute(route: LanConnectionRoute | null) {
	if (!route) return '在线'
	if (route.family === 'ipv6' && route.kind === 'lan') return 'IPv6 内网直连'
	if (route.family === 'ipv6') return 'IPv6 公网直连'
	if (route.family === 'ipv4' && route.kind === 'lan') return 'IPv4 局域网直连'
	if (route.family === 'ipv4' && route.kind === 'nat') return 'IPv4 NAT 直连'
	if (route.family === 'ipv4') return 'IPv4 直连'
	return '未知直连'
}

export interface LanConnectionTransport {
	readonly id: string
	readonly generation: number
	readonly bufferedAmount: number
	isOpen(): boolean
	send(data: Uint8Array): boolean
	negotiateChunkSize(peerMaxChunkSize?: number): Promise<number>
	waitUntilWritable(highWatermark: number, lowWatermark: number, timeoutMs: number, signal?: AbortSignal): Promise<void>
}

export type LanTransportHealthStats = {
	connectionState: RTCPeerConnectionState
	iceConnectionState: RTCIceConnectionState
	candidatePairId: string
	bytesSent: number
	bytesReceived: number
	consentRequestsSent: number | null
	responsesReceived: number | null
}

export type LanTransportState = 'connecting' | 'connected' | 'disconnected' | 'failed' | 'channel-closed' | 'closed'

export type LanTransportCreateOptions = {
	role: LanRole
	generation: number
	negotiationId: string
	onDescription: (description: RTCSessionDescriptionInit) => void
	onCandidate: (candidate: RTCIceCandidateInit | null) => void
	onData: (data: unknown) => void
	onState: (state: LanTransportState) => void
	onReady: () => void
}

export interface LanReconnectTransport extends LanConnectionTransport {
	readonly negotiationId: string
	start(): Promise<void>
	setNegotiationId(negotiationId: string): void
	restartIce(negotiationId: string): Promise<void>
	acceptDescription(description: RTCSessionDescriptionInit): Promise<void>
	addRemoteCandidate(candidate: RTCIceCandidateInit | null): Promise<void>
	getHealthStats(): Promise<LanTransportHealthStats>
	inspectRoute(): Promise<LanConnectionRoute>
	close(): void
}

export type LanTransportFactory = (options: LanTransportCreateOptions) => LanReconnectTransport
