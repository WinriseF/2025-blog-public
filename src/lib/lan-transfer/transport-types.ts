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
	readonly bufferedAmount: number
	isOpen(): boolean
	send(data: Uint8Array): boolean
	negotiateChunkSize(peerMaxChunkSize?: number): Promise<number>
	waitUntilWritable(highWatermark: number, lowWatermark: number, timeoutMs: number, signal?: AbortSignal): Promise<void>
}

export type LanTransportState = 'connecting' | 'connected' | 'disconnected' | 'failed' | 'channel-closed' | 'closed'
export type LanTransportRole = 'offerer' | 'answerer'

export type LanTransportCreateOptions = {
	role: LanTransportRole
	negotiationId: string
	onDescription: (description: RTCSessionDescriptionInit, negotiationId: string, attemptToken: number) => void
	onCandidate: (candidate: RTCIceCandidateInit | null) => void
	onData: (data: unknown) => void
	onState: (state: LanTransportState) => void
	onReady: () => void
}

export interface LanReconnectTransport extends LanConnectionTransport {
	readonly negotiationId: string
	start(attemptToken: number): Promise<void>
	setNegotiationId(negotiationId: string): void
	restartIce(negotiationId: string, attemptToken: number): Promise<void>
	acceptDescription(description: RTCSessionDescriptionInit, attemptToken: number): Promise<void>
	addRemoteCandidate(candidate: RTCIceCandidateInit | null): Promise<void>
	probe(timeoutMs?: number): Promise<boolean>
	inspectRoute(): Promise<LanConnectionRoute>
	close(): void
}

export type LanTransportFactory = (options: LanTransportCreateOptions) => LanReconnectTransport
