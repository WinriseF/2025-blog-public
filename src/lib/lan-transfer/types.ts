export const LAN_LIMITS = {
	maxBytes: 200 * 1024 * 1024,
	chunkSize: 64 * 1024,
	bufferHighWatermark: 1024 * 1024,
	bufferLowWatermark: 256 * 1024
} as const

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
	id: string
	name: string
	mime: string
	size: number
	fileCount: number
}

export type LanTransferAccept = {
	type: 'transfer-accept'
	id: string
}

export type LanTransferReject = {
	type: 'transfer-reject'
	id: string
	reason?: string
}

export type LanTransferComplete = {
	type: 'transfer-complete'
	id: string
}

export type LanTransferCancel = {
	type: 'transfer-cancel'
	id: string
	reason?: string
}

export type LanControlMessage = LanTransferRequest | LanTransferAccept | LanTransferReject | LanTransferComplete | LanTransferCancel

export type PreparedLanFile = {
	id: string
	name: string
	mime: string
	size: number
	fileCount: number
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
