export const LAN_PROTOCOL_VERSION = 4

export const LAN_LIMITS = {
	memoryMaxBytes: 200 * 1024 * 1024,
	imageInlinePreviewBytes: 12 * 1024 * 1024,
	indexedDbRecommendedBytes: 1 * 1024 * 1024 * 1024,
	indexedDbExperimentalBytes: 2 * 1024 * 1024 * 1024,
	opfsRecommendedBytes: 10 * 1024 * 1024 * 1024,
	experimentalMaxBytes: 50 * 1024 * 1024 * 1024,
	dataChannelSafeChunkSize: 60 * 1024,
	defaultChunkSize: 60 * 1024,
	conservativeChunkSize: 60 * 1024,
	bufferHighWatermark: 8 * 1024 * 1024,
	bufferLowWatermark: 2 * 1024 * 1024,
	mobileBufferHighWatermark: 4 * 1024 * 1024,
	mobileBufferLowWatermark: 1 * 1024 * 1024,
	bufferDrainTimeoutMs: 60 * 1000,
	maxSenderAheadBytes: 64 * 1024 * 1024,
	mobileMaxSenderAheadBytes: 32 * 1024 * 1024,
} as const

export type LanRole = 'host' | 'guest'
export type LanDeviceType = 'desktop' | 'phone' | 'tablet' | 'unknown'
export type LanSignalType = 'announce' | 'signal' | 'peer-left'
export type LanConnectionState = 'idle' | 'signaling' | 'discovered' | 'connecting' | 'connected' | 'failed'
export type LanStorageKind = 'memory' | 'file' | 'opfs' | 'indexeddb'
export type LanBrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'wechat' | 'qq' | 'unknown'
export type LanPlatformKind = 'desktop' | 'android' | 'ios' | 'unknown'
export type LanMessageDirection = 'in' | 'out' | 'system'
export type LanMessageKind = 'text' | 'attachments' | 'system'
export type LanMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'received'
export type LanAttachmentKind = 'image' | 'voice' | 'file'
export type LanAttachmentStatus = 'queued' | 'offered' | 'receiving' | 'sending' | 'complete' | 'failed' | 'cancelled'

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
	from: string
	to: string
	seq: number
	ts: number
	peer?: LanPeer
	signal?: unknown
}

export type LanPresencePayload = {
	peerId: string
	role: LanRole
	peer: LanPeer
	tokenHash: string
	joinedAt: number
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

export type LanAttachmentManifest = {
	id: string
	kind: LanAttachmentKind
	name: string
	mime: string
	size: number
	lastModified: number
	durationMs?: number
	chunkSize: number
	chunkCount: number
	suggestedStorage: LanStorageKind
}

export type LanAttachment = LanAttachmentManifest & {
	direction: Exclude<LanMessageDirection, 'system'>
	storage: LanStorageKind
	status: LanAttachmentStatus
	progress: number
	url?: string
	previewUrl?: string
	error?: string
}

export type LanChatMessage = {
	id: string
	direction: LanMessageDirection
	kind: LanMessageKind
	text?: string
	attachments: LanAttachment[]
	status: LanMessageStatus
	createdAt: number
	peerId?: string
	error?: string
}

export type LanFileRecord = {
	id: string
	messageId: string
	direction: Exclude<LanMessageDirection, 'system'>
	kind: LanAttachmentKind
	name: string
	mime: string
	size: number
	storage: LanStorageKind
	status: LanAttachmentStatus
	url?: string
	createdAt: number
	peerName?: string
}

export type LanChatMessageControl = {
	type: 'chat-message'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	text: string
	createdAt: number
	peerId: string
}

export type LanAttachmentOffer = {
	type: 'attachment-offer'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	messageId: string
	createdAt: number
	peerId: string
	attachment: LanAttachmentManifest
}

export type LanAttachmentAccept = {
	type: 'attachment-accept'
	id: string
	messageId: string
	storage: LanStorageKind
	receivedRanges: Array<[number, number]>
	receivedBytes: number
}

export type LanAttachmentProgress = {
	type: 'attachment-progress'
	id: string
	messageId: string
	received: number
	chunkCount: number
	storage: LanStorageKind
}

export type LanAttachmentComplete = {
	type: 'attachment-complete'
	id: string
	messageId: string
	sent: number
	chunkCount: number
}

export type LanAttachmentReceived = {
	type: 'attachment-received'
	id: string
	messageId: string
	received: number
	expected: number
	chunkCount: number
	storage: LanStorageKind
}

export type LanAttachmentCancel = {
	type: 'attachment-cancel'
	id: string
	messageId?: string
	reason?: string
}

export type LanResumeQuery = {
	type: 'resume-query'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	ids: string[]
}

export type LanResumeState = {
	type: 'resume-state'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	attachments: Array<{
		id: string
		messageId: string
		receivedRanges: Array<[number, number]>
		receivedBytes: number
		storage: LanStorageKind
	}>
}

export type LanControlMessage =
	| LanCapability
	| LanChatMessageControl
	| LanAttachmentOffer
	| LanAttachmentAccept
	| LanAttachmentProgress
	| LanAttachmentComplete
	| LanAttachmentReceived
	| LanAttachmentCancel
	| LanResumeQuery
	| LanResumeState

export type PreparedLanAttachment = LanAttachmentManifest & {
	messageId: string
	file: File
}
