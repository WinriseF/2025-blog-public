import type { LanRole } from './types'

export interface LanConnectionTransport {
	readonly id: string
	readonly generation: number
	isOpen(): boolean
	send(data: Uint8Array): boolean
	waitUntilWritable(highWatermark: number, lowWatermark: number, timeoutMs: number): Promise<void>
	waitUntilDrained(lowWatermark: number, timeoutMs: number): Promise<void>
}

export type LanTransportState = 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

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
	readonly lastInboundAt: number
	start(): Promise<void>
	setNegotiationId(negotiationId: string): void
	restartIce(negotiationId: string): Promise<void>
	acceptDescription(description: RTCSessionDescriptionInit): Promise<void>
	addRemoteCandidate(candidate: RTCIceCandidateInit | null): Promise<void>
	probe(timeoutMs?: number): Promise<boolean>
	inspectRoute(): Promise<string>
	close(): void
}

export type LanTransportFactory = (options: LanTransportCreateOptions) => LanReconnectTransport
