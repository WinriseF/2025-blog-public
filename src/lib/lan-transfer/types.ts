export const LAN_LIMITS = {
	maxBytes: 200 * 1024 * 1024,
	chunkSize: 64 * 1024,
	bufferHighWatermark: 1024 * 1024,
	bufferLowWatermark: 256 * 1024,
	pollMs: 800
} as const

export type LanRole = 'host' | 'guest'
export type LanDeviceType = 'desktop' | 'phone' | 'tablet' | 'unknown'

export type LanPeer = {
	id: string
	role: LanRole
	name: string
	deviceType: LanDeviceType
	joinedAt: number
}

export type LanRoomResponse = {
	ok: true
	roomId: string
	token?: string
	peerId: string
	role: LanRole
	peer?: LanPeer
	peers?: LanPeer[]
	pairExpiresAt: number
	sessionExpiresAt: number
}

export type LanMessage = {
	id: string
	from: string
	type: 'peer-joined' | 'signal' | 'peer-left'
	payload: unknown
	createdAt: number
}

export type LanPollResponse = {
	ok: true
	roomId: string
	peerId: string
	peers: LanPeer[]
	messages: LanMessage[]
}

export type LanErrorBody = {
	error: string
	message: string
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
