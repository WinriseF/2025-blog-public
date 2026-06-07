export const TRANSFER_CODE_LENGTH = 6
export const TRANSFER_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/
export const TRANSFER_UPLOAD_CONTENT_TYPE = 'application/octet-stream'

export const TRANSFER_LIMITS = {
	minPasswordLength: 6,
	maxTextBytes: 1024 * 1024,
	maxFileBytes: 100 * 1024 * 1024,
	maxCreatePerIpPerDay: 20,
	uploadUrlSeconds: 10 * 60
} as const

export type TransferKind = 'text' | 'file'
export type TransferStatus = 'pending' | 'ready'

export type TransferCreateRequest = {
	kind: TransferKind
	name: string
	contentType: string
	size: number
	salt: string
	iv: string
	proof: string
}

export type TransferCreateResponse = {
	code: string
	uploadUrl: string
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
	iv: string
	status: TransferStatus
	expireAt: number
	createdAt: number
}

export type TransferErrorBody = {
	error: string
	message: string
}
