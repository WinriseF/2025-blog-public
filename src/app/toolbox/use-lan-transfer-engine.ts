'use client'

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type SimplePeer from 'simple-peer'
import { attachmentFromOffer, attachmentFromPrepared, chooseReceiveStorage, fileRecord, messageBase, receiveStorageCandidates, transferMeta } from './lan-transfer-controller-utils'
import { useLanChatState } from './use-lan-chat-state'
import { assertCanReceiveFile, detectLanCapability, selectStorageForFile } from '@/lib/lan-transfer/capability'
import { createStorageEngine } from '@/lib/lan-transfer/storage/storage-manager'
import type { LanStorageEngine, TransferFileMeta } from '@/lib/lan-transfer/storage/types'
import {
	decodeFrame,
	downloadUrl,
	encodeControl,
	formatBytes,
	imagePreviewUrl,
	messageId,
	prepareLanAttachment,
	sendPreparedAttachment,
} from '@/lib/lan-transfer/file-transfer'
import {
	LAN_LIMITS,
	LAN_PROTOCOL_VERSION,
	type LanAttachmentAccept,
	type LanAttachmentKind,
	type LanAttachmentOffer,
	type LanAttachmentReceived,
	type LanCapability,
	type LanControlMessage,
	type LanPeer,
	type LanSession,
	type PreparedLanAttachment,
} from '@/lib/lan-transfer/types'

type IncomingAttachment = { offer: LanAttachmentOffer; meta: TransferFileMeta; engine: LanStorageEngine; received: number; chunkCount: number }
type PreparedEntry = { file: PreparedLanAttachment; createdAt: number; acked: number; ranges: Array<[number, number]>; offered: boolean; accepted?: LanAttachmentAccept }
type CachedReceivedFile = { engine: LanStorageEngine; fileId: string; messageId: string; size: number; chunkCount: number; storage: TransferFileMeta['storage']; url?: string }
type ProgressCheckpoint = { bytes: number; ts: number }

type UseLanTransferEngineOptions = {
	connected: boolean
	peerRef: MutableRefObject<SimplePeer.Instance | null>
	sessionRef: MutableRefObject<LanSession | null>
	remotePeerRef: MutableRefObject<LanPeer | null>
	remoteCapabilityRef: MutableRefObject<LanCapability | null>
	localCapabilityRef: MutableRefObject<LanCapability | null>
	setLocalCapability: (capability: LanCapability | null) => void
	setRemoteCapability: (capability: LanCapability | null) => void
	setStatus: (status: string) => void
}

export function useLanTransferEngine(options: UseLanTransferEngineOptions) {
	const chat = useLanChatState()
	const preparedRef = useRef(new Map<string, PreparedEntry>())
	const incomingRef = useRef(new Map<string, IncomingAttachment>())
	const pendingOffersRef = useRef(new Map<string, LanAttachmentOffer>())
	const receivedCacheRef = useRef(new Map<string, CachedReceivedFile>())
	const cancelledIncomingRef = useRef(new Map<string, string>())
	const progressAckRef = useRef(new Map<string, ProgressCheckpoint>())
	const outgoingObjectUrlsRef = useRef<string[]>([])
	const queueRef = useRef<string[]>([])
	const activeSendingRef = useRef<string | null>(null)
	const chunkWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

	const sendControl = useCallback((message: LanControlMessage) => {
		const peer = options.peerRef.current
		if (!peer?.connected) return false
		try {
			peer.send(encodeControl(message))
			return true
		} catch {
			return false
		}
	}, [options.peerRef])

	const shouldReportProgress = useCallback((id: string, received: number, total: number, force = false) => {
		const now = Date.now()
		const previous = progressAckRef.current.get(id)
		if (force || received >= total || !previous || received - previous.bytes >= LAN_LIMITS.progressAckIntervalBytes || now - previous.ts >= LAN_LIMITS.progressAckIntervalMs) {
			progressAckRef.current.set(id, { bytes: received, ts: now })
			return true
		}
		return false
	}, [])

	const confirmReceived = useCallback((id: string, messageIdValue: string, size: number, chunkCount: number, storage: TransferFileMeta['storage']) => {
		sendControl({ type: 'attachment-received', id, messageId: messageIdValue, received: size, expected: size, chunkCount, storage })
	}, [sendControl])

	const cleanupIncoming = useCallback((id: string) => {
		const current = incomingRef.current.get(id)
		if (!current) return
		incomingRef.current.delete(id)
		void chunkWriteQueueRef.current.then(() => current.engine.cleanup(current.meta.id)).catch(() => {})
	}, [])

	const failAttachment = useCallback((id: string, messageIdValue: string, reason: string, notifyPeer = true) => {
		chat.patchAttachment({ id, messageId: messageIdValue, status: 'failed', error: reason })
		chat.patchFileRecord(id, { status: 'failed' })
		if (notifyPeer) sendControl({ type: 'attachment-cancel', id, messageId: messageIdValue, reason })
		preparedRef.current.delete(id)
		if (activeSendingRef.current === id) activeSendingRef.current = null
		queueRef.current = queueRef.current.filter(item => item !== id)
		progressAckRef.current.delete(id)
		cleanupIncoming(id)
		options.setStatus(reason)
	}, [chat, cleanupIncoming, options, sendControl])

	const pumpQueue = useCallback(() => {
		const peer = options.peerRef.current
		if (!peer?.connected) return
		preparedRef.current.forEach(entry => {
			if (entry.offered) return
			const offered = sendControl({
				type: 'attachment-offer',
				protocolVersion: LAN_PROTOCOL_VERSION,
				messageId: entry.file.messageId,
				createdAt: entry.createdAt,
				peerId: options.sessionRef.current?.peerId || '',
				attachment: {
					id: entry.file.id,
					kind: entry.file.kind,
					name: entry.file.name,
					mime: entry.file.mime,
					size: entry.file.size,
					lastModified: entry.file.lastModified,
					durationMs: entry.file.durationMs,
					chunkSize: entry.file.chunkSize,
					chunkCount: entry.file.chunkCount,
					suggestedStorage: entry.file.suggestedStorage,
				},
			})
			if (offered) {
				entry.offered = true
				chat.patchAttachment({ id: entry.file.id, messageId: entry.file.messageId, status: 'offered' })
				options.setStatus(`等待对方下载 ${entry.file.name}`)
			}
		})
		if (activeSendingRef.current) return
		const nextId = queueRef.current.find(id => preparedRef.current.get(id)?.accepted)
		if (!nextId) return
		const entry = preparedRef.current.get(nextId)
		const message = entry?.accepted
		if (!entry || !message) return
		queueRef.current = queueRef.current.filter(id => id !== nextId)
		activeSendingRef.current = nextId
		chat.patchAttachment({ id: message.id, messageId: message.messageId, status: 'sending', progress: entry.file.size ? message.receivedBytes / entry.file.size : 1 })
		options.setStatus(`正在发送 ${entry.file.name}`)
		let lastProgressBytes = message.receivedBytes
		let lastProgressAt = Date.now()
		void sendPreparedAttachment(peer, entry.file, done => {
			const now = Date.now()
			if (done < entry.file.size && done - lastProgressBytes < LAN_LIMITS.progressAckIntervalBytes && now - lastProgressAt < LAN_LIMITS.progressAckIntervalMs) return
			lastProgressBytes = done
			lastProgressAt = now
			chat.patchAttachment({ id: message.id, messageId: message.messageId, progress: entry.file.size ? done / entry.file.size : 1, status: 'sending' })
		}, {
			mobile: options.remoteCapabilityRef.current?.platform === 'android' || options.remoteCapabilityRef.current?.platform === 'ios',
			getAckedBytes: () => entry.acked,
			receivedRanges: entry.ranges,
		}).then(() => {
			chat.patchAttachment({ id: message.id, messageId: message.messageId, progress: 1, status: 'sending' })
			options.setStatus(`已发送 ${entry.file.name}，等待对方接收`)
		}).catch(error => {
			activeSendingRef.current = null
			if (!options.peerRef.current?.connected) {
				if (entry.accepted && !queueRef.current.includes(message.id)) queueRef.current.unshift(message.id)
				chat.patchAttachment({ id: message.id, messageId: message.messageId, status: 'queued' })
				options.setStatus('连接断了，恢复后会继续')
				return
			}
			failAttachment(message.id, message.messageId, error instanceof Error ? error.message : '发送失败')
			pumpQueue()
		})
	}, [chat, failAttachment, options, sendControl])

	const completeOutgoing = useCallback((message: LanAttachmentReceived) => {
		preparedRef.current.delete(message.id)
		queueRef.current = queueRef.current.filter(id => id !== message.id)
		activeSendingRef.current = null
		chat.patchAttachment({ id: message.id, messageId: message.messageId, status: 'complete', progress: 1 })
		chat.patchFileRecord(message.id, { status: 'complete' })
		options.setStatus('对方已收到')
		pumpQueue()
	}, [chat, options, pumpQueue])

	const isUserCancel = useCallback((error: unknown) => {
		const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : ''
		return name === 'AbortError' || name === 'NotAllowedError'
	}, [])

	const prepareIncoming = useCallback(async (message: LanAttachmentOffer, capability: LanCapability | null) => {
		const candidates = receiveStorageCandidates(message.attachment.size, message.attachment.suggestedStorage, capability)
		const failures: string[] = []
		for (const storage of candidates) {
			const engine = createStorageEngine(storage)
			const meta = transferMeta(message, storage)
			try {
				if (storage !== 'file') await engine.cleanup(meta.id).catch(() => {})
				await engine.prepare(meta)
				const manifest = await engine.getManifest(meta.id)
				return { engine, meta, received: manifest?.receivedBytes || 0, chunkCount: manifest?.receivedChunks || 0 }
			} catch (error) {
				await engine.cleanup(meta.id).catch(() => {})
				if (storage === 'file' && isUserCancel(error)) throw error
				failures.push(error instanceof Error ? error.message : '无法准备保存文件')
			}
		}
		throw new Error(failures[0] || '当前设备不能接收该文件')
	}, [isUserCancel])

	const handleOffer = useCallback(async (message: LanAttachmentOffer) => {
		const capability = options.localCapabilityRef.current || (options.sessionRef.current ? await detectLanCapability(options.sessionRef.current.peerId, message.attachment.size) : null)
		if (capability) {
			options.localCapabilityRef.current = capability
			options.setLocalCapability(capability)
		}
		try {
			const cancelledReason = cancelledIncomingRef.current.get(message.attachment.id)
			if (cancelledReason) {
				sendControl({ type: 'attachment-cancel', id: message.attachment.id, messageId: message.messageId, reason: cancelledReason })
				return
			}
			const cached = receivedCacheRef.current.get(message.attachment.id)
			if (cached && cached.size === message.attachment.size && cached.chunkCount === message.attachment.chunkCount) {
				const attachment = { ...attachmentFromOffer(message, cached.storage, 1), status: 'complete' as const, url: cached.url, previewUrl: message.attachment.kind === 'image' ? cached.url : undefined }
				chat.upsertAttachment(messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment)
				chat.upsertFileRecord(fileRecord(message.messageId, attachment, options.remotePeerRef.current?.name))
				confirmReceived(message.attachment.id, message.messageId, cached.size, cached.chunkCount, cached.storage)
				return
			}
			if (capability) assertCanReceiveFile(message.attachment.size, capability)
			const current = incomingRef.current.get(message.attachment.id)
			if (current) {
				const ranges = await current.engine.getReceivedRanges(current.meta.id)
				sendControl({ type: 'attachment-accept', id: message.attachment.id, messageId: message.messageId, storage: current.engine.kind, receivedRanges: ranges, receivedBytes: current.received })
				return
			}
			pendingOffersRef.current.set(message.attachment.id, message)
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability)
			const attachment = { ...attachmentFromOffer(message, storage, 0), status: 'offered' as const }
			chat.upsertAttachment(messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment)
			chat.upsertFileRecord(fileRecord(message.messageId, attachment, options.remotePeerRef.current?.name))
			options.setStatus(`${message.attachment.name} 等待下载`)
		} catch (error) {
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability)
			const attachment = { ...attachmentFromOffer(message, storage, 0), status: 'failed' as const, error: error instanceof Error ? error.message : '当前设备不能接收该文件' }
			chat.upsertAttachment(messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment)
			chat.upsertFileRecord(fileRecord(message.messageId, attachment, options.remotePeerRef.current?.name))
			sendControl({ type: 'attachment-cancel', id: message.attachment.id, messageId: message.messageId, reason: error instanceof Error ? error.message : '当前设备不能接收该文件' })
		}
	}, [chat, confirmReceived, options, sendControl])

	const startReceivingAttachment = useCallback(async (id: string) => {
		const offer = pendingOffersRef.current.get(id)
		if (!offer) return
		let capability = options.localCapabilityRef.current
		try {
			if (!capability && options.sessionRef.current) {
				capability = await detectLanCapability(options.sessionRef.current.peerId, offer.attachment.size)
				options.localCapabilityRef.current = capability
				options.setLocalCapability(capability)
			}
			if (capability) assertCanReceiveFile(offer.attachment.size, capability)
			chat.patchAttachment({ id, messageId: offer.messageId, status: 'receiving', progress: 0 })
			chat.patchFileRecord(id, { status: 'receiving' })
			const prepared = await prepareIncoming(offer, capability)
			const current = { offer, ...prepared }
			incomingRef.current.set(id, current)
			pendingOffersRef.current.delete(id)
			chat.patchAttachment({ id, messageId: offer.messageId, storage: current.engine.kind, progress: offer.attachment.size ? current.received / offer.attachment.size : 1 })
			chat.patchFileRecord(id, { storage: current.engine.kind })
			const ranges = await current.engine.getReceivedRanges(current.meta.id)
			sendControl({ type: 'attachment-accept', id, messageId: offer.messageId, storage: current.engine.kind, receivedRanges: ranges, receivedBytes: current.received })
			options.setStatus(`正在接收 ${offer.attachment.name}`)
		} catch (error) {
			const reason = isUserCancel(error) ? '已取消下载' : error instanceof Error ? error.message : '当前设备不能接收该文件'
			const status = isUserCancel(error) ? 'cancelled' : 'failed'
			pendingOffersRef.current.delete(id)
			if (status === 'cancelled') cancelledIncomingRef.current.set(id, reason)
			chat.patchAttachment({ id, messageId: offer.messageId, status, error: reason })
			chat.patchFileRecord(id, { status })
			sendControl({ type: 'attachment-cancel', id, messageId: offer.messageId, reason })
			options.setStatus(reason)
		}
	}, [chat, isUserCancel, options, prepareIncoming, sendControl])

	const finishIncoming = useCallback(async (id: string, messageIdValue: string, sent?: number, chunkCount?: number) => {
		const current = incomingRef.current.get(id)
		if (!current) return
		await chunkWriteQueueRef.current
		const manifest = await current.engine.getManifest(current.meta.id)
		if (!manifest) return failAttachment(id, messageIdValue, '接收失败，请重新发送')
		if (typeof sent === 'number' && sent !== current.offer.attachment.size) return failAttachment(id, messageIdValue, '文件信息不一致，请重新发送')
		if (typeof chunkCount === 'number' && chunkCount !== manifest.receivedChunks) return failAttachment(id, messageIdValue, '接收不完整，请重新发送')
		if (manifest.receivedBytes !== current.offer.attachment.size || manifest.receivedChunks !== current.offer.attachment.chunkCount) return failAttachment(id, messageIdValue, `接收不完整：${formatBytes(manifest.receivedBytes)} / ${formatBytes(current.offer.attachment.size)}`)
		const finalized = await current.engine.finalize(current.meta)
		chat.patchAttachment({ id, messageId: messageIdValue, status: 'complete', progress: 1, url: finalized.url, previewUrl: current.offer.attachment.kind === 'image' ? finalized.url : undefined })
		chat.patchFileRecord(id, { status: 'complete', url: finalized.url })
		receivedCacheRef.current.set(id, { engine: current.engine, fileId: current.meta.id, messageId: messageIdValue, size: current.offer.attachment.size, chunkCount: manifest.receivedChunks, storage: current.engine.kind, url: finalized.url })
		progressAckRef.current.delete(id)
		confirmReceived(id, messageIdValue, current.offer.attachment.size, manifest.receivedChunks, current.engine.kind)
		incomingRef.current.delete(id)
		if (finalized.url) downloadUrl(current.offer.attachment.name, finalized.url)
		options.setStatus(finalized.directSave ? '接收完成，文件已保存' : '接收完成，可在文件页查看')
	}, [chat, confirmReceived, failAttachment, options])

	const queueIncomingChunk = useCallback((id: string, chunkIndex: number, bytes: Uint8Array) => {
		chunkWriteQueueRef.current = chunkWriteQueueRef.current.then(async () => {
			const current = incomingRef.current.get(id)
			if (!current) return
			if (chunkIndex < 0 || chunkIndex >= current.offer.attachment.chunkCount) throw new Error('接收失败，请重新发送')
			const manifest = await current.engine.writeChunk(current.meta, chunkIndex, bytes)
			if (manifest.receivedBytes > current.offer.attachment.size) throw new Error('接收失败，请重新发送')
			current.received = manifest.receivedBytes
			current.chunkCount = manifest.receivedChunks
			const done = current.received >= current.offer.attachment.size || current.chunkCount >= current.offer.attachment.chunkCount
			if (shouldReportProgress(id, current.received, current.offer.attachment.size, done)) {
				const progress = current.offer.attachment.size ? current.received / current.offer.attachment.size : 1
				chat.patchAttachment({ id, messageId: current.offer.messageId, status: 'receiving', progress })
				chat.patchFileRecord(id, { status: 'receiving' })
				sendControl({ type: 'attachment-progress', id, messageId: current.offer.messageId, received: current.received, chunkCount: current.chunkCount, storage: current.engine.kind })
			}
		}).catch(error => {
			const current = incomingRef.current.get(id)
			if (current) failAttachment(id, current.offer.messageId, error instanceof Error ? error.message : '接收失败')
		})
	}, [chat, failAttachment, sendControl, shouldReportProgress])

	const handleControl = useCallback(async (message: LanControlMessage) => {
		if ('protocolVersion' in message && message.protocolVersion !== LAN_PROTOCOL_VERSION) return void options.setStatus('双方页面不一致，请刷新后重试')
		if (message.type === 'capability') {
			options.remoteCapabilityRef.current = message
			options.setRemoteCapability(message)
			options.setStatus('已连接，可以发送消息和文件')
			pumpQueue()
			return
		}
		if (message.type === 'chat-message') return chat.upsertMessage({ id: message.id, direction: 'in', kind: 'text', text: message.text, attachments: [], status: 'received', createdAt: message.createdAt, peerId: message.peerId })
		if (message.type === 'attachment-offer') return void (await handleOffer(message))
		if (message.type === 'attachment-accept') {
			const entry = preparedRef.current.get(message.id)
			if (!entry) return
			entry.accepted = message
			entry.ranges = message.receivedRanges
			entry.acked = message.receivedBytes
			if (!queueRef.current.includes(message.id)) queueRef.current.push(message.id)
			pumpQueue()
			return
		}
		if (message.type === 'attachment-progress') {
			const entry = preparedRef.current.get(message.id)
			if (entry) {
				entry.acked = Math.max(entry.acked, message.received)
				chat.patchAttachment({ id: message.id, messageId: message.messageId, progress: entry.file.size ? message.received / entry.file.size : 1, status: 'sending' })
			}
			return
		}
		if (message.type === 'attachment-complete') return void (await finishIncoming(message.id, message.messageId, message.sent, message.chunkCount))
		if (message.type === 'attachment-received') return completeOutgoing(message)
		if (message.type === 'attachment-cancel') {
			failAttachment(message.id, message.messageId || '', message.reason || '已取消', false)
			pumpQueue()
			return
		}
		if (message.type === 'resume-query') {
			const attachments = await Promise.all(message.ids.map(async id => {
				const cached = receivedCacheRef.current.get(id)
				if (cached) {
					confirmReceived(id, cached.messageId, cached.size, cached.chunkCount, cached.storage)
					return null
				}
				const current = incomingRef.current.get(id)
				return current ? { id, messageId: current.offer.messageId, receivedRanges: await current.engine.getReceivedRanges(current.meta.id), receivedBytes: current.received, storage: current.engine.kind } : null
			}))
			sendControl({ type: 'resume-state', protocolVersion: LAN_PROTOCOL_VERSION, attachments: attachments.filter((item): item is NonNullable<typeof item> => Boolean(item)) })
			return
		}
		if (message.type === 'resume-state') for (const item of message.attachments) {
			const entry = preparedRef.current.get(item.id)
			if (entry) {
				entry.ranges = item.receivedRanges
				entry.acked = item.receivedBytes
			}
		}
	}, [chat, completeOutgoing, confirmReceived, failAttachment, finishIncoming, handleOffer, options, pumpQueue, sendControl])

	const handlePeerData = useCallback((data: unknown) => {
		const frame = decodeFrame(data)
		if (!frame) return
		if (frame.kind === 'control') return void handleControl(frame.message).catch(error => options.setStatus(error instanceof Error ? error.message : '发送失败'))
		if (frame.kind === 'corrupt') {
			const current = incomingRef.current.get(frame.id)
			if (current) failAttachment(frame.id, current.offer.messageId, '接收失败，请重新发送')
			return
		}
		queueIncomingChunk(frame.id, frame.index, frame.bytes)
	}, [failAttachment, handleControl, options, queueIncomingChunk])

	const resumeAfterConnect = useCallback(() => {
		activeSendingRef.current = null
		preparedRef.current.forEach(entry => {
			entry.offered = false
		})
		sendControl({ type: 'resume-query', protocolVersion: LAN_PROTOCOL_VERSION, ids: Array.from(preparedRef.current.keys()) })
		pumpQueue()
	}, [pumpQueue, sendControl])

	const pauseTransfers = useCallback(() => {
		const activeId = activeSendingRef.current
		if (activeId && preparedRef.current.get(activeId)?.accepted && !queueRef.current.includes(activeId)) queueRef.current.unshift(activeId)
		activeSendingRef.current = null
	}, [])

	const sendText = useCallback((text: string) => {
		const trimmed = text.trim()
		if (!trimmed) return
		if (!options.connected) return options.setStatus('请先连接设备')
		const id = messageId()
		const createdAt = Date.now()
		chat.upsertMessage({ id, direction: 'out', kind: 'text', text: trimmed, attachments: [], status: 'sent', createdAt, peerId: options.sessionRef.current?.peerId })
		sendControl({ type: 'chat-message', protocolVersion: LAN_PROTOCOL_VERSION, id, text: trimmed, createdAt, peerId: options.sessionRef.current?.peerId || '' })
	}, [chat, options, sendControl])

	const sendFiles = useCallback(async (files: File[], forcedKind?: LanAttachmentKind, durationMs?: number) => {
		if (!files.length) return
		if (!options.connected) return options.setStatus('请先连接设备')
		const remote = options.remoteCapabilityRef.current
		const createdAt = Date.now()
		const id = messageId()
		try {
			const prepared = files.map(file => prepareLanAttachment(file, {
				messageId: id,
				kind: forcedKind,
				chunkSize: remote?.limits.recommendedChunkSize,
				suggestedStorage: selectStorageForFile(file.size, remote),
				maxBytes: remote?.limits.maxExperimentalFileSize,
				durationMs,
			}))
			const attachments = await Promise.all(prepared.map(async file => {
				const previewUrl = file.kind === 'image' ? await imagePreviewUrl(file.file) : ''
				const localUrl = previewUrl || URL.createObjectURL(file.file)
				outgoingObjectUrlsRef.current.push(localUrl)
				return { ...attachmentFromPrepared(file, file.suggestedStorage, previewUrl), url: localUrl }
			}))
			chat.upsertMessage({ id, direction: 'out', kind: 'attachments', attachments, status: 'queued', createdAt, peerId: options.sessionRef.current?.peerId })
			for (const attachment of attachments) chat.upsertFileRecord(fileRecord(id, attachment, options.remotePeerRef.current?.name))
			for (const file of prepared) {
				preparedRef.current.set(file.id, { file, createdAt, acked: 0, ranges: [], offered: false })
			}
			pumpQueue()
		} catch (error) {
			options.setStatus(error instanceof Error ? error.message : '发送失败')
		}
	}, [chat, options, pumpQueue])

	const clearFileRecord = useCallback((id: string) => {
		const cached = receivedCacheRef.current.get(id)
		if (cached?.url) URL.revokeObjectURL(cached.url)
		if (cached) void cached.engine.cleanup(cached.fileId).catch(() => {})
		receivedCacheRef.current.delete(id)
		chat.patchFileRecord(id, { status: 'cancelled', url: undefined })
	}, [chat])

	useEffect(() => () => {
		receivedCacheRef.current.forEach(file => {
			if (file.url) URL.revokeObjectURL(file.url)
			void file.engine.cleanup(file.fileId).catch(() => {})
		})
		receivedCacheRef.current.clear()
		cancelledIncomingRef.current.clear()
		progressAckRef.current.clear()
		pendingOffersRef.current.clear()
		outgoingObjectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
		outgoingObjectUrlsRef.current = []
	}, [])

	return {
		messages: chat.messages,
		fileRecords: chat.fileRecords,
		addSystemMessage: chat.addSystemMessage,
		handlePeerData,
		resumeAfterConnect,
		pauseTransfers,
		pumpQueue,
		sendText,
		sendFiles,
		startReceivingAttachment,
		clearFileRecord,
		downloadAttachment: downloadUrl,
	}
}
