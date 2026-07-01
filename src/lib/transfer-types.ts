export const TRANSFER_CODE_LENGTH = 6
export const TRANSFER_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/
export const TRANSFER_UPLOAD_CONTENT_TYPE = 'application/octet-stream'

export const TRANSFER_LIMITS = {
	minPasswordLength: 6,
	publicRelayChunkBytes: 4 * 1024 * 1024,
	maxTextBytes: 4 * 1024 * 1024,
	maxFileBytes: 200 * 1024 * 1024,
	maxCreatePerIpPerDay: 20,
	uploadUrlSeconds: 10 * 60
} as const

export type TransferKind = 'text' | 'file'
export type TransferStatus = 'pending' | 'ready'

export type TransferChunkMeta = {
	index: number
	iv: string
	plainSize: number
	cipherSize?: number
}

export type TransferChunkUpload = {
	index: number
	url: string
}

export type TransferOpenChunk = TransferChunkMeta & {
	url: string
}

export type TransferCreateRequest = {
	kind: TransferKind
	name: string
	contentType: string
	size: number
	salt: string
	proof: string
	chunked: true
	chunkSize: number
	chunkCount: number
	chunks: TransferChunkMeta[]
}

export type TransferCreateResponse = {
	code: string
	uploadUrls: TransferChunkUpload[]
	uploadExpiresAt: number
	expireAt: number
}

export type TransferCompleteRequest = {
	code: string
}

export type TransferOpenRequest = {
	code: string
	proof: string
}

export type TransferPublicMeta = {
	code: string
	kind: TransferKind
	name: string
	contentType: string
	size: number
	salt: string
	status: TransferStatus
	expireAt: number
	createdAt: number
	chunked: true
	chunkSize: number
	chunkCount: number
	chunks: TransferChunkMeta[]
	encryptedSize?: number
}

export type TransferOpenResponse = Omit<TransferPublicMeta, 'chunks'> & {
	chunks: TransferOpenChunk[]
}

export type TransferErrorBody = {
	error: string
	message: string
}

export type TransferStatsObjectType = 'chunk' | 'meta' | 'consumed' | 'code-index' | 'expire-index' | 'rate' | 'other'

export type TransferStatsObject = {
	key: string
	type: TransferStatsObjectType
	bytes: number
	contentType: string
	etag: string
	error?: string
}

export type TransferStatsResponse = {
	ok: true
	generatedAt: number
	store: string
	objectCount: number
	totalBytes: number
	byType: Partial<Record<TransferStatsObjectType, { count: number; bytes: number }>>
	metadataErrorCount: number
	errors: Array<{ key: string; type: TransferStatsObjectType; message: string }>
	top: TransferStatsObject[]
}

export type TransferCleanupResponse = {
	ok: true
	cleaned: number
	scanned: number
	deleteErrorCount: number
	errors: Array<{ key: string; message: string }>
}
