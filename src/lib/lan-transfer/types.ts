export const LAN_PROTOCOL_VERSION = 3

export const LAN_LIMITS = {
	memoryMaxBytes: 200 * 1024 * 1024,
	multiFileZipMaxBytes: 500 * 1024 * 1024,
	indexedDbRecommendedBytes: 1 * 1024 * 1024 * 1024,
	indexedDbExperimentalBytes: 2 * 1024 * 1024 * 1024,
	opfsRecommendedBytes: 10 * 1024 * 1024 * 1024,
	experimentalMaxBytes: 50 * 1024 * 1024 * 1024,
	opfsDesktopChunkSize: 1024 * 1024,
	opfsMobileChunkSize: 512 * 1024,
	defaultChunkSize: 256 * 1024,
	mobileChunkSize: 128 * 1024,
	legacyChunkSize: 64 * 1024,
	bufferHighWatermark: 8 * 1024 * 1024,
	bufferLowWatermark: 2 * 1024 * 1024,
	mobileBufferHighWatermark: 4 * 1024 * 1024,
	mobileBufferLowWatermark: 1 * 1024 * 1024,
	bufferDrainTimeoutMs: 60 * 1000,
	receiveAckTimeoutMs: 10 * 60 * 1000
} as const

export type LanRole = 'host' | 'guest'
export type LanDeviceType = 'desktop' | 'phone' | 'tablet' | 'unknown'
export type LanSignalType = 'hello' | 'signal' | 'peer-left'
export type LanStorageKind = 'memory' | 'opfs' | 'indexeddb'
export type LanBrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'wechat' | 'qq' | 'unknown'
export type LanPlatformKind = 'desktop' | 'android' | 'ios' | 'unknown'

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

export type LanCapability = {
	type: 'capability'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	platform: LanPlatformKind
	browser: LanBrowserKind
	isEmbeddedBrowser: boolean
	storage: {
		memory: true
		opfs: boolean
		indexedDB: boolean
		fileSystemAccess: boolean
		quota?: number
		usage?: number
		available?: number
		persisted?: boolean
	}
	limits: {
		maxRecommendedFileSize: number
		maxExperimentalFileSize: number
		recommendedChunkSize: number
		recommendedStorage: LanStorageKind
	}
	notes: string[]
}

export type LanTransferRequest = {
	type: 'transfer-request'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	name: string
	mime: string
	size: number
	fileCount: number
	lastModified: number
	chunkSize: number
	chunkCount: number
	suggestedStorage: LanStorageKind
}

export type LanTransferAccept = {
	type: 'transfer-accept'
	id: string
	storage: LanStorageKind
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
}

export type LanTransferReceived = {
	type: 'transfer-received'
	id: string
	received: number
	expected: number
	chunkCount: number
	storage: LanStorageKind
}

export type LanTransferCancel = {
	type: 'transfer-cancel'
	id: string
	reason?: string
}

export type LanControlMessage = LanCapability | LanTransferRequest | LanTransferAccept | LanTransferReject | LanTransferComplete | LanTransferReceived | LanTransferCancel

export type PreparedLanFile = {
	id: string
	name: string
	mime: string
	size: number
	fileCount: number
	lastModified: number
	chunkSize: number
	chunkCount: number
	file: File
	suggestedStorage: LanStorageKind
}

export type ReceivedLanFile = {
	id: string
	name: string
	mime: string
	size: number
	url: string
	storage: LanStorageKind
	receivedAt: number
	cacheStatus: 'retained'
}

export type LanProgressState = {
	id: string
	name: string
	size: number
	done: number
	label: string
	stage?: string
}
