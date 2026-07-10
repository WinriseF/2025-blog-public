import type { LanAttachment, LanAttachmentStatus, LanChatMessage, LanFileRecord, LanMessageStatus } from '@/lib/lan-transfer/types'

export type LanChatState = {
	messages: LanChatMessage[]
	fileRecords: LanFileRecord[]
}

export type MessagePatch = Partial<Omit<LanChatMessage, 'attachments'>> & { attachments?: LanAttachment[] }
export type AttachmentPatch = Partial<LanAttachment> & { id: string; messageId?: string }

export type LanChatAction =
	| { type: 'upsert-message'; message: LanChatMessage }
	| { type: 'upsert-attachment'; message: Omit<LanChatMessage, 'attachments'>; attachment: LanAttachment }
	| { type: 'merge-history'; messages: LanChatMessage[] }
	| { type: 'patch-message'; id: string; patch: MessagePatch }
	| { type: 'patch-attachment'; patch: AttachmentPatch }
	| { type: 'upsert-file-record'; record: LanFileRecord }
	| { type: 'patch-file-record'; id: string; patch: Partial<LanFileRecord> }

function attachmentMessageStatus(attachments: LanAttachment[]): LanMessageStatus {
	if (attachments.some(item => item.status === 'failed' || item.status === 'cancelled')) return 'failed'
	if (attachments.length && attachments.every(item => item.status === 'complete')) return 'delivered'
	if (attachments.some(item => item.status === 'sending' || item.status === 'receiving')) return 'sending'
	if (attachments.some(item => item.status === 'offered')) return 'sent'
	return 'queued'
}

function upsertMessage(messages: LanChatMessage[], message: LanChatMessage) {
	const index = messages.findIndex(item => item.id === message.id)
	if (index < 0) return [...messages, message]
	const next = messages.slice()
	next[index] = { ...next[index], ...message, attachments: message.attachments }
	return next
}

function patchMessage(messages: LanChatMessage[], id: string, patch: MessagePatch) {
	return messages.map(message => (message.id === id ? { ...message, ...patch, attachments: patch.attachments || message.attachments } : message))
}

function patchAttachment(messages: LanChatMessage[], patch: AttachmentPatch) {
	return messages.map(message => {
		if (patch.messageId && message.id !== patch.messageId) return message
		let changed = false
		const attachments = message.attachments.map(attachment => {
			if (attachment.id !== patch.id) return attachment
			changed = true
			return { ...attachment, ...patch }
		})
		if (!changed) return message
		return { ...message, attachments, status: attachmentMessageStatus(attachments) }
	})
}

function upsertAttachment(messages: LanChatMessage[], messageBase: Omit<LanChatMessage, 'attachments'>, attachment: LanAttachment) {
	const existing = messages.find(message => message.id === messageBase.id)
	if (!existing) return [...messages, { ...messageBase, attachments: [attachment] }]
	const attachments = existing.attachments.some(item => item.id === attachment.id)
		? existing.attachments.map(item => (item.id === attachment.id ? { ...item, ...attachment } : item))
		: [...existing.attachments, attachment]
	return upsertMessage(messages, { ...existing, ...messageBase, attachments, status: attachmentMessageStatus(attachments) })
}

const attachmentStatusRank: Record<LanAttachmentStatus, number> = {
	queued: 0,
	offered: 1,
	receiving: 2,
	sending: 2,
	failed: 1,
	cancelled: 1,
	complete: 3,
}

function mergeAttachment(current: LanAttachment | undefined, incoming: LanAttachment) {
	if (!current) return incoming
	const progress = Math.max(current.progress || 0, incoming.progress || 0)
	const transferredBytes = Math.max(current.transferredBytes || 0, incoming.transferredBytes || 0) || undefined
	const status = attachmentStatusRank[current.status] >= attachmentStatusRank[incoming.status] ? current.status : incoming.status
	return {
		...current,
		...incoming,
		direction: current.direction,
		status,
		progress,
		transferredBytes,
		url: current.url || incoming.url,
		previewUrl: current.previewUrl || incoming.previewUrl,
		speedBps: current.speedBps,
		etaSeconds: current.etaSeconds,
	}
}

function mergeMessage(current: LanChatMessage, incoming: LanChatMessage) {
	const attachments = incoming.attachments.map(attachment => mergeAttachment(current.attachments.find(item => item.id === attachment.id), attachment))
	for (const attachment of current.attachments) {
		if (!attachments.some(item => item.id === attachment.id)) attachments.push(attachment)
	}
	return {
		...current,
		...incoming,
		direction: current.direction,
		status: current.kind === 'attachments' ? attachmentMessageStatus(attachments) : current.status,
		attachments,
	}
}

function mergeHistory(messages: LanChatMessage[], incoming: LanChatMessage[]) {
	const next = messages.slice()
	for (const message of incoming) {
		const index = next.findIndex(item => item.id === message.id)
		if (index < 0) {
			next.push(message)
			continue
		}
		next[index] = mergeMessage(next[index], message)
	}
	return next
}

function upsertFileRecord(records: LanFileRecord[], record: LanFileRecord) {
	const index = records.findIndex(item => item.id === record.id)
	if (index < 0) return [record, ...records]
	const next = records.slice()
	next[index] = { ...next[index], ...record }
	return next
}

export function createEmptyLanChatState(): LanChatState {
	return { messages: [], fileRecords: [] }
}

export function lanChatReducer(state: LanChatState, action: LanChatAction): LanChatState {
	if (action.type === 'upsert-message') return { ...state, messages: upsertMessage(state.messages, action.message) }
	if (action.type === 'upsert-attachment') return { ...state, messages: upsertAttachment(state.messages, action.message, action.attachment) }
	if (action.type === 'merge-history') return { ...state, messages: mergeHistory(state.messages, action.messages) }
	if (action.type === 'patch-message') return { ...state, messages: patchMessage(state.messages, action.id, action.patch) }
	if (action.type === 'patch-attachment') return { ...state, messages: patchAttachment(state.messages, action.patch) }
	if (action.type === 'upsert-file-record') return { ...state, fileRecords: upsertFileRecord(state.fileRecords, action.record) }
	if (action.type === 'patch-file-record') return { ...state, fileRecords: state.fileRecords.map(record => (record.id === action.id ? { ...record, ...action.patch } : record)) }
	return state
}
