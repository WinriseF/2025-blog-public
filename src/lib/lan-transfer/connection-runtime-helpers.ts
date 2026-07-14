import { chooseStorageKind } from './storage/storage-manager'
import type { TransferFileMeta } from './storage/types'
import { LAN_LIMITS, type LanAttachment, type LanAttachmentKind, type LanAttachmentOffer, type LanCapability, type LanChatHistoryMessage, type LanChatMessage, type LanFileRecord, type PreparedLanAttachment } from './types'

export function transferMeta(offer: LanAttachmentOffer, storage: TransferFileMeta['storage']): TransferFileMeta {
	return { ...offer.attachment, storage }
}

export function messageBase(id: string, direction: 'in' | 'out', createdAt: number, peerId?: string): Omit<LanChatMessage, 'attachments'> {
	return { id, direction, kind: 'attachments', status: direction === 'out' ? 'queued' : 'received', createdAt, peerId }
}

export function attachmentFromPrepared(file: PreparedLanAttachment, storage: TransferFileMeta['storage'], previewUrl = ''): LanAttachment {
	return { ...file, direction: 'out', storage, status: 'queued', progress: 0, previewUrl }
}

export function attachmentFromOffer(offer: LanAttachmentOffer, storage: TransferFileMeta['storage'], progress = 0): LanAttachment {
	return { ...offer.attachment, direction: 'in', storage, status: 'receiving', progress }
}

export function historyMessageForSync(message: LanChatMessage): LanChatHistoryMessage {
	return { ...message, attachments: message.attachments.map(({ url, previewUrl, speedBps, etaSeconds, ...attachment }) => attachment) }
}

export function historyMessageFromRemote(message: LanChatHistoryMessage): LanChatMessage {
	const direction = message.direction === 'out' ? 'in' : message.direction === 'in' ? 'out' : 'system'
	return {
		...message,
		direction,
		status: direction === 'in' ? 'received' : direction === 'out' ? 'sent' : 'received',
		attachments: message.attachments.map(attachment => ({ ...attachment, direction: attachment.direction === 'out' ? 'in' : 'out', speedBps: undefined, etaSeconds: undefined })),
	}
}

export function fileRecord(messageId: string, attachment: LanAttachment, peerName?: string): LanFileRecord {
	return {
		id: attachment.id,
		messageId,
		direction: attachment.direction,
		kind: attachment.kind,
		name: attachment.name,
		mime: attachment.mime,
		size: attachment.size,
		storage: attachment.storage,
		status: attachment.status,
		url: attachment.url,
		createdAt: Date.now(),
		peerName,
	}
}

export function receiveStorageCandidates(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null, allowDirectFile = true) {
	const candidates: TransferFileMeta['storage'][] = []
	const add = (kind: TransferFileMeta['storage']) => {
		if (!candidates.includes(kind)) candidates.push(kind)
	}
	if (allowDirectFile && capability?.storage.fileSystemAccess && capability.platform === 'desktop') add('file')
	if (requested === 'opfs' && capability?.storage.opfs) add('opfs')
	if (requested === 'indexeddb' && capability?.storage.indexedDB) add('indexeddb')
	if (capability?.storage.opfs) add('opfs')
	if (capability?.storage.indexedDB) add('indexeddb')
	if (size <= LAN_LIMITS.memoryMaxBytes) add('memory')
	const fallback = chooseStorageKind(size, requested, capability)
	if (fallback !== 'file' || allowDirectFile) if (fallback !== 'memory' || size <= LAN_LIMITS.memoryMaxBytes) add(fallback)
	return candidates
}

export function chooseReceiveStorage(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null, allowDirectFile = true) {
	return receiveStorageCandidates(size, requested, capability, allowDirectFile)[0] || 'memory'
}

export function isUserCancel(error: unknown) {
	const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : ''
	return name === 'AbortError' || name === 'NotAllowedError'
}

export function isInlineMediaKind(kind: LanAttachmentKind) {
	return kind === 'image' || kind === 'voice'
}
