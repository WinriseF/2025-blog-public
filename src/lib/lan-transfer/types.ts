export const LAN_LIMITS = {
	maxBytes: 200 * 1024 * 1024,
	chunkSize: 32 * 1024,
	bufferHighWatermark: 512 * 1024,
	bufferLowWatermark: 128 * 1024,
	bufferDrainTimeoutMs: 45 * 1000,
	receiveAckTimeoutMs: 90 * 1000
} as const

export const LAN_PROTOCOL_VERSION = 2

export type LanRole = 'host' | 'guest'
export type LanDeviceType = 'desktop' | 'phone' | 'tablet' | 'unknown'
export type LanSignalType = 'hello' | 'signal' | 'peer-left'

export type LanPeer = {
	id: string
	role: LanRole
	name: string
	deviceType: LanDeviceType
	joinedAt: number
}

export type LanSession = {
	roomId: string
	token: string
	tokenHash: string
	role: LanRole
	peerId: string
	localPeer: LanPeer
	pairExpiresAt: number
	sessionExpiresAt: number
}

export type LanSignalMessage = {
	type: LanSignalType
	roomId: string
	tokenHash: string
	peerId: string
	ts: number
	to?: string
	peer?: LanPeer
	signal?: unknown
}

export type LanTransferRequest = {
	type: 'transfer-request'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	name: string
	mime: string
	size: number
	fileCount: number
	chunkSize: number
	chunkCount: number
	createdAt: number
}

export type LanTransferAccept = {
	type: 'transfer-accept'
	id: string
	acceptedAt: number
}

export type LanTransferReject = {
	type: 'transfer-reject'
	id: string
	reason?: string
}

export type LanTransferComplete = {
	type: 'transfer-complete'
	id: string
	sent: number
	chunkCount: number
	completedAt: number
}

export type LanTransferReceived = {
	type: 'transfer-received'
	id: string
	received: number
	expected: number
	receivedAt: number
}

export type LanTransferCancel = {
	type: 'transfer-cancel'
	id: string
	reason?: string
}

export type LanControlMessage = LanTransferRequest | LanTransferAccept | LanTransferReject | LanTransferComplete | LanTransferReceived | LanTransferCancel

export type PreparedLanFile = {
	id: string
	name: string
	mime: string
	size: number
	fileCount: number
	chunkCount: number
	bytes: Uint8Array
}

export type ReceivedLanFile = {
	id: string
	name: string
	mime: string
	size: number
	url: string
	receivedAt: number
}

export type LanProgressState = {
	id: string
	name: string
	size: number
	done: number
	label: string
}
