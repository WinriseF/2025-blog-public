import type { LanNativeAgentAdvertisement, LanNativeAgentTicket } from './native-agent/types'
export type { LanNativeAgentAdvertisement, LanNativeAgentTicket } from './native-agent/types'

export const LAN_PROTOCOL_VERSION = 10
export const LAN_FILE_IO_BATCH_BYTES = 4 * 1024 * 1024

export const LAN_CHUNK_TIERS = [
	{ frameSize: 128 * 1024, chunkSize: 124 * 1024 },
	{ frameSize: 64 * 1024, chunkSize: 60 * 1024 },
] as const

export const LAN_LIMITS = {
	memoryMaxBytes: 200 * 1024 * 1024,
	imageInlinePreviewBytes: 12 * 1024 * 1024,
	indexedDbRecommendedBytes: 1 * 1024 * 1024 * 1024,
	indexedDbExperimentalBytes: 2 * 1024 * 1024 * 1024,
	opfsRecommendedBytes: 10 * 1024 * 1024 * 1024,
	experimentalMaxBytes: 50 * 1024 * 1024 * 1024,
	dataChannelFrameHeaderReserve: 4 * 1024,
	dataChannelMaxFrameSize: LAN_CHUNK_TIERS[0].frameSize,
	dataChannelMaxChunkSize: LAN_CHUNK_TIERS[0].chunkSize,
	dataChannelFallbackChunkSize: LAN_CHUNK_TIERS[1].chunkSize,
	defaultChunkSize: LAN_CHUNK_TIERS[1].chunkSize,
	bufferHighWatermark: 2 * 1024 * 1024,
	bufferLowWatermark: 512 * 1024,
	mobileBufferHighWatermark: 1 * 1024 * 1024,
	mobileBufferLowWatermark: 256 * 1024,
	bufferDrainTimeoutMs: 60 * 1000,
	maxSenderAheadBytes: 64 * 1024 * 1024,
	mobileMaxSenderAheadBytes: 32 * 1024 * 1024,
	maxAttachmentAheadBytes: 16 * 1024 * 1024,
	mobileMaxAttachmentAheadBytes: 8 * 1024 * 1024,
	schedulerQuantumBytes: 512 * 1024,
	schedulerPriorityWeight: 4,
	schedulerPriorityMaxBytes: 8 * 1024 * 1024,
	schedulerMaxActive: 4,
	mobileSchedulerMaxActive: 2,
	progressAckIntervalBytes: 1024 * 1024,
	progressAckIntervalMs: 500,
} as const

export type LanRole = 'host' | 'guest'
export type LanDeviceType = 'desktop' | 'phone' | 'tablet' | 'unknown'
export type LanSignalType = 'announce' | 'reconnect-request' | 'rebuild' | 'ice-restart' | 'offer' | 'answer' | 'candidate' | 'signal-ack' | 'peer-left'
export type LanSignalState = 'connecting' | 'online' | 'retrying' | 'offline' | 'closed'
export type LanConnectionState = 'idle' | 'discovered' | 'connecting' | 'connected' | 'suspect' | 'ice-restarting' | 'rebuilding' | 'backoff' | 'closed'
export type LanStorageKind = 'memory' | 'file' | 'opfs' | 'indexeddb'
export type LanBrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'wechat' | 'qq' | 'unknown'
export type LanPlatformKind = 'desktop' | 'android' | 'ios' | 'unknown'
export type LanMessageDirection = 'in' | 'out' | 'system'
export type LanMessageKind = 'text' | 'attachments' | 'system'
export type LanMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'received'
export type LanAttachmentKind = 'image' | 'voice' | 'file'
export type LanAttachmentStatus = 'queued' | 'offered' | 'receiving' | 'sending' | 'complete' | 'failed' | 'cancelled'

export type LanPeer = {
	instanceId: string
	deviceId: string
	role: LanRole
	name: string
	deviceType: LanDeviceType
	avatarSeed: string
	joinedAt: number
}

export type LanSession = {
	roomId: string
	token: string
	tokenHash: string
	role: LanRole
	instanceId: string
	localPeer: LanPeer
	pairExpiresAt: number
	sessionExpiresAt: number
}

export type LanSignalMessage = {
	type: LanSignalType
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	roomId: string
	tokenHash: string
	fromDeviceId: string
	fromInstanceId: string
	toDeviceId: string
	toInstanceId: string
	messageId: string
	seq: number
	ts: number
	generation: number
	negotiationId: string
	peer?: LanPeer
	description?: RTCSessionDescriptionInit
	candidate?: RTCIceCandidateInit | null
	ackFor?: string
	reason?: string
	hardRecovery?: boolean
}

export type LanPresencePayload = {
	instanceId: string
	role: LanRole
	peer: LanPeer
	tokenHash: string
	joinedAt: number
}

export type LanSignalTarget = Pick<LanPeer, 'deviceId' | 'instanceId'>
export type LanSignalSendDetails = Partial<Pick<LanSignalMessage, 'generation' | 'negotiationId' | 'description' | 'candidate' | 'ackFor' | 'reason' | 'hardRecovery'>>

export type LanCapability = {
	type: 'capability'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	seq?: number
	createdAt?: number
	platform: LanPlatformKind
	browser: LanBrowserKind
	isEmbeddedBrowser: boolean
	webTransport: boolean
	nativeAgent?: LanNativeAgentAdvertisement
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

export type LanNativeAgentTicketRequest = {
	type: 'native-agent-ticket-request'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	seq: number
	createdAt: number
	requestId: string
}

export type LanNativeAgentTicketResponse = {
	type: 'native-agent-ticket-response'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	seq: number
	createdAt: number
	requestId: string
	ticket?: LanNativeAgentTicket
	error?: string
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
	transferredBytes?: number
	speedBps?: number
	etaSeconds?: number
	phase?: 'transferring' | 'confirming'
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
	seq: number
}

export type LanChatReceipt = {
	type: 'chat-receipt'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	messageIds: string[]
	peerId: string
	seq: number
	createdAt: number
}

export type LanAttachmentOffer = {
	type: 'attachment-offer'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	messageId: string
	createdAt: number
	peerId: string
	seq: number
	attachment: LanAttachmentManifest
}

export type LanAttachmentAccept = {
	type: 'attachment-accept'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	messageId: string
	peerId: string
	seq: number
	createdAt: number
	storage: LanStorageKind
	receivedRanges: Array<[number, number]>
	receivedBytes: number
}

export type LanAttachmentProgress = {
	type: 'attachment-progress'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	messageId: string
	peerId: string
	seq: number
	createdAt: number
	received: number
	chunkCount: number
	storage: LanStorageKind
}

export type LanAttachmentComplete = {
	type: 'attachment-complete'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	messageId: string
	peerId: string
	seq: number
	createdAt: number
	sent: number
	chunkCount: number
}

export type LanAttachmentReceived = {
	type: 'attachment-received'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	messageId: string
	peerId: string
	seq: number
	createdAt: number
	received: number
	expected: number
	chunkCount: number
	storage: LanStorageKind
}

export type LanAttachmentCancel = {
	type: 'attachment-cancel'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	id: string
	peerId: string
	seq: number
	createdAt: number
	messageId?: string
	reason?: string
}

export type LanResumeQuery = {
	type: 'resume-query'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	seq: number
	createdAt: number
	resumeId: string
	transportGeneration: number
	transportEpoch: number
	ids: string[]
}

export type LanResumeState = {
	type: 'resume-state'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	seq: number
	createdAt: number
	resumeId: string
	transportGeneration: number
	transportEpoch: number
	attachments: Array<{
		id: string
		messageId?: string
		state: 'receiving' | 'complete' | 'unknown'
		receivedRanges: Array<[number, number]>
		receivedBytes: number
		receivedChunks: number
		storage?: LanStorageKind
	}>
}

export type LanChatHistoryMessage = Omit<LanChatMessage, 'attachments'> & {
	attachments: Array<Omit<LanAttachment, 'url' | 'previewUrl' | 'speedBps' | 'etaSeconds'>>
}

export type LanChatHistorySync = {
	type: 'chat-history'
	protocolVersion: typeof LAN_PROTOCOL_VERSION
	peerId: string
	seq: number
	createdAt: number
	messages: LanChatHistoryMessage[]
}

export type LanControlMessage =
	| LanCapability
	| LanNativeAgentTicketRequest
	| LanNativeAgentTicketResponse
	| LanChatMessageControl
	| LanChatReceipt
	| LanAttachmentOffer
	| LanAttachmentAccept
	| LanAttachmentProgress
	| LanAttachmentComplete
	| LanAttachmentReceived
	| LanAttachmentCancel
	| LanResumeQuery
	| LanResumeState
	| LanChatHistorySync

export type PreparedLanAttachment = LanAttachmentManifest & {
	messageId: string
	file: File
}
