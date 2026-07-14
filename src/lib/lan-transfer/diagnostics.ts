import { LAN_LIMITS, type LanConnectionState } from './types'
import type { LanConnectionRoute } from './transport-types'

export type LanRecoveryKind = 'suspect' | 'ice-restart' | 'rebuild' | 'recovered'

export type LanRecoveryEvent = {
	kind: LanRecoveryKind
	reason: string
	at: number
}

export type LanTransferDiagnostics = {
	connectionState: LanConnectionState
	route: LanConnectionRoute | null
	active: boolean
	chunkSize: number
	networkSendBps: number
	networkReceiveBps: number
	diskCommitBps: number
	dataChannelBufferedBytes: number
	queuedBytes: number
	receiveWindowBytes: number
	bufferHighWatermark: number
	bufferLowWatermark: number
	maxUncommittedBytes: number
	pausedReason?: string
	reconnectCount: number
	latestReconnectReason?: string
	recoveryHistory: LanRecoveryEvent[]
}

export function emptyLanTransferDiagnostics(): LanTransferDiagnostics {
	return {
		connectionState: 'idle',
		route: null,
		active: false,
		chunkSize: LAN_LIMITS.defaultChunkSize,
		networkSendBps: 0,
		networkReceiveBps: 0,
		diskCommitBps: 0,
		dataChannelBufferedBytes: 0,
		queuedBytes: 0,
		receiveWindowBytes: 0,
		bufferHighWatermark: LAN_LIMITS.bufferHighWatermark,
		bufferLowWatermark: LAN_LIMITS.bufferLowWatermark,
		maxUncommittedBytes: LAN_LIMITS.maxSenderAheadBytes,
		reconnectCount: 0,
		recoveryHistory: [],
	}
}
