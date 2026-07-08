'use client'

import { useCallback, useReducer } from 'react'
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
	if (action.type === 'patch-message') return { ...state, messages: patchMessage(state.messages, action.id, action.patch) }
	if (action.type === 'patch-attachment') return { ...state, messages: patchAttachment(state.messages, action.patch) }
	if (action.type === 'upsert-file-record') return { ...state, fileRecords: upsertFileRecord(state.fileRecords, action.record) }
	if (action.type === 'patch-file-record') return { ...state, fileRecords: state.fileRecords.map(record => (record.id === action.id ? { ...record, ...action.patch } : record)) }
	return state
}

export function useLanChatState() {
	const [state, dispatch] = useReducer(lanChatReducer, createEmptyLanChatState())

	const upsertMessage = useCallback((message: LanChatMessage) => dispatch({ type: 'upsert-message', message }), [])
	const upsertAttachment = useCallback((message: Omit<LanChatMessage, 'attachments'>, attachment: LanAttachment) => dispatch({ type: 'upsert-attachment', message, attachment }), [])
	const patchMessage = useCallback((id: string, patch: MessagePatch) => dispatch({ type: 'patch-message', id, patch }), [])
	const patchAttachment = useCallback((patch: AttachmentPatch) => dispatch({ type: 'patch-attachment', patch }), [])
	const upsertFileRecord = useCallback((record: LanFileRecord) => dispatch({ type: 'upsert-file-record', record }), [])
	const patchFileRecord = useCallback((id: string, patch: Partial<LanFileRecord>) => dispatch({ type: 'patch-file-record', id, patch }), [])
	const addSystemMessage = useCallback((text: string) => {
		upsertMessage({
			id: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			direction: 'system',
			kind: 'system',
			text,
			attachments: [],
			status: 'received',
			createdAt: Date.now(),
		})
	}, [upsertMessage])

	const patchAttachmentStatus = useCallback((id: string, messageId: string, status: LanAttachmentStatus, progress?: number, error?: string) => {
		patchAttachment({ id, messageId, status, progress, error })
		patchFileRecord(id, { status })
	}, [patchAttachment, patchFileRecord])

	return {
		...state,
		upsertMessage,
		upsertAttachment,
		patchMessage,
		patchAttachment,
		upsertFileRecord,
		patchFileRecord,
		patchAttachmentStatus,
		addSystemMessage,
	}
}

export type LanChatController = ReturnType<typeof useLanChatState>
