import { assertCanReceiveFile, detectLanCapability, selectStorageForFile } from './capability'
import {
	decodeFrame,
	downloadUrl,
	encodeControl,
	formatBytes,
	imagePreviewUrl,
	messageId,
	prepareLanAttachment,
	sendPreparedAttachment,
	type LanConnectionTransport,
} from './file-transfer'
import { createStorageEngine, chooseStorageKind } from './storage/storage-manager'
import type { TransferFileMeta, LanStorageEngine } from './storage/types'
import {
	LAN_LIMITS,
	LAN_PROTOCOL_VERSION,
	type LanAttachment,
	type LanAttachmentAccept,
	type LanAttachmentKind,
	type LanAttachmentOffer,
	type LanAttachmentReceived,
	type LanCapability,
	type LanChatMessage,
	type LanControlMessage,
	type LanFileRecord,
	type LanSession,
	type PreparedLanAttachment,
} from './types'

type IncomingAttachment = { offer: LanAttachmentOffer; meta: TransferFileMeta; engine: LanStorageEngine; received: number; chunkCount: number }
type PreparedEntry = { file: PreparedLanAttachment; createdAt: number; acked: number; ranges: Array<[number, number]>; offered: boolean; accepted?: LanAttachmentAccept }
type CachedReceivedFile = { engine: LanStorageEngine; fileId: string; messageId: string; size: number; chunkCount: number; storage: TransferFileMeta['storage']; url?: string }
type ProgressCheckpoint = { bytes: number; ts: number }

type RuntimeContext = {
	session: LanSession
	remotePeerName?: string
	remoteCapability?: LanCapability | null
	localCapability?: LanCapability | null
}

type SendFilesOptions = {
	kind?: LanAttachmentKind
	durationMs?: number
}

type AttachmentPatch = Partial<LanAttachment> & { id: string; messageId?: string }

export type LanConnectionRuntimeEvent =
	| { type: 'message-upsert'; message: LanChatMessage }
	| { type: 'attachment-upsert'; message: Omit<LanChatMessage, 'attachments'>; attachment: LanAttachment }
	| { type: 'attachment-patch'; patch: AttachmentPatch }
	| { type: 'file-record-upsert'; record: LanFileRecord }
	| { type: 'file-record-patch'; id: string; patch: Partial<LanFileRecord> }
	| { type: 'status'; message: string }
	| { type: 'local-capability'; capability: LanCapability }
	| { type: 'remote-capability'; capability: LanCapability }
	| { type: 'download-ready'; name: string; url: string }

type RuntimeListener = (event: LanConnectionRuntimeEvent) => void

function transferMeta(offer: LanAttachmentOffer, storage: TransferFileMeta['storage']): TransferFileMeta {
	return { ...offer.attachment, storage }
}

function messageBase(id: string, direction: 'in' | 'out', createdAt: number, peerId?: string): Omit<LanChatMessage, 'attachments'> {
	return { id, direction, kind: 'attachments', status: direction === 'out' ? 'queued' : 'received', createdAt, peerId }
}

function attachmentFromPrepared(file: PreparedLanAttachment, storage: TransferFileMeta['storage'], previewUrl = ''): LanAttachment {
	return { ...file, direction: 'out', storage, status: 'queued', progress: 0, previewUrl }
}

function attachmentFromOffer(offer: LanAttachmentOffer, storage: TransferFileMeta['storage'], progress = 0): LanAttachment {
	return { ...offer.attachment, direction: 'in', storage, status: 'receiving', progress }
}

function fileRecord(messageIdValue: string, attachment: LanAttachment, peerName?: string): LanFileRecord {
	return {
		id: attachment.id,
		messageId: messageIdValue,
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

function receiveStorageCandidates(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null) {
	const candidates: TransferFileMeta['storage'][] = []
	const add = (kind: TransferFileMeta['storage']) => {
		if (!candidates.includes(kind)) candidates.push(kind)
	}

	if (capability?.storage.fileSystemAccess && capability.platform === 'desktop') add('file')
	if (requested === 'opfs' && capability?.storage.opfs) add('opfs')
	if (requested === 'indexeddb' && capability?.storage.indexedDB) add('indexeddb')
	if (capability?.storage.opfs) add('opfs')
	if (capability?.storage.indexedDB) add('indexeddb')
	if (size <= LAN_LIMITS.memoryMaxBytes) add('memory')
	const fallback = chooseStorageKind(size, requested, capability)
	if (fallback !== 'memory' || size <= LAN_LIMITS.memoryMaxBytes) add(fallback)
	return candidates
}

function chooseReceiveStorage(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null) {
	return receiveStorageCandidates(size, requested, capability)[0] || 'memory'
}

function isUserCancel(error: unknown) {
	const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : ''
	return name === 'AbortError' || name === 'NotAllowedError'
}

export class LanConnectionRuntime {
	private listeners = new Set<RuntimeListener>()
	private transport: LanConnectionTransport | null = null
	private context: RuntimeContext | null = null
	private seq = 0
	private prepared = new Map<string, PreparedEntry>()
	private incoming = new Map<string, IncomingAttachment>()
	private pendingOffers = new Map<string, LanAttachmentOffer>()
	private receivedCache = new Map<string, CachedReceivedFile>()
	private cancelledIncoming = new Map<string, string>()
	private progressAck = new Map<string, ProgressCheckpoint>()
	private queue: string[] = []
	private activeSending: string | null = null
	private chunkWriteQueue: Promise<void> = Promise.resolve()
	private outgoingObjectUrls: string[] = []
	private destroyed = false

	subscribe(listener: RuntimeListener) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	attachTransport(transport: LanConnectionTransport, context: RuntimeContext) {
		if (this.destroyed) return
		this.transport = transport
		this.context = context
		if (context.localCapability) this.emit({ type: 'local-capability', capability: context.localCapability })
		if (context.remoteCapability) this.emit({ type: 'remote-capability', capability: context.remoteCapability })
		this.resumeAfterConnect()
	}

	detachTransport() {
		const activeId = this.activeSending
		if (activeId && this.prepared.get(activeId)?.accepted && !this.queue.includes(activeId)) this.queue.unshift(activeId)
		this.activeSending = null
		this.transport = null
	}

	destroy() {
		this.detachTransport()
		this.destroyed = true
		this.reset()
		this.listeners.clear()
	}

	reset() {
		this.detachTransport()
		this.receivedCache.forEach(file => {
			if (file.url) URL.revokeObjectURL(file.url)
			void file.engine.cleanup(file.fileId).catch(() => {})
		})
		this.receivedCache.clear()
		this.cancelledIncoming.clear()
		this.progressAck.clear()
		this.pendingOffers.clear()
		this.prepared.clear()
		this.incoming.clear()
		this.queue = []
		this.activeSending = null
		this.chunkWriteQueue = Promise.resolve()
		this.outgoingObjectUrls.forEach(url => URL.revokeObjectURL(url))
		this.outgoingObjectUrls = []
	}

	handleFrame(data: unknown) {
		const frame = decodeFrame(data)
		if (!frame) return
		if (frame.kind === 'control') return void this.handleControl(frame.message).catch(error => this.setStatus(error instanceof Error ? error.message : '发送失败'))
		if (frame.kind === 'corrupt') {
			const current = this.incoming.get(frame.id)
			if (current) this.failAttachment(frame.id, current.offer.messageId, '接收失败，请重新发送')
			return
		}
		this.queueIncomingChunk(frame.id, frame.index, frame.bytes)
	}

	resumeAfterConnect() {
		if (!this.isOpen()) return
		this.activeSending = null
		this.prepared.forEach(entry => {
			entry.offered = false
		})
		void this.sendLocalCapability().then(() => {
			this.sendControl({ ...this.controlBase('resume-query'), ids: Array.from(this.prepared.keys()) })
			this.flushOffersAndQueue()
		})
	}

	sendText(text: string) {
		const trimmed = text.trim()
		const context = this.context
		if (!trimmed) return
		if (!context || !this.isOpen()) return this.setStatus('请先连接设备')
		const id = messageId()
		const createdAt = Date.now()
		this.emit({ type: 'message-upsert', message: { id, direction: 'out', kind: 'text', text: trimmed, attachments: [], status: 'sent', createdAt, peerId: context.session.peerId } })
		this.sendControl({ ...this.controlBase('chat-message', createdAt), id, text: trimmed })
	}

	async sendFiles(files: File[], options: SendFilesOptions = {}) {
		const context = this.context
		if (!files.length) return
		if (!context || !this.isOpen()) return this.setStatus('请先连接设备')
		const remote = context.remoteCapability || null
		const createdAt = Date.now()
		const id = messageId()
		try {
			const prepared = files.map(file => prepareLanAttachment(file, {
				messageId: id,
				kind: options.kind,
				chunkSize: remote?.limits.recommendedChunkSize,
				suggestedStorage: selectStorageForFile(file.size, remote),
				maxBytes: remote?.limits.maxExperimentalFileSize,
				durationMs: options.durationMs,
			}))
			const attachments = await Promise.all(prepared.map(async file => {
				const previewUrl = file.kind === 'image' ? await imagePreviewUrl(file.file) : ''
				const localUrl = previewUrl || URL.createObjectURL(file.file)
				this.outgoingObjectUrls.push(localUrl)
				return { ...attachmentFromPrepared(file, file.suggestedStorage, previewUrl), url: localUrl }
			}))
			this.emit({ type: 'message-upsert', message: { id, direction: 'out', kind: 'attachments', attachments, status: 'queued', createdAt, peerId: context.session.peerId } })
			for (const attachment of attachments) this.emit({ type: 'file-record-upsert', record: fileRecord(id, attachment, context.remotePeerName) })
			for (const file of prepared) this.prepared.set(file.id, { file, createdAt, acked: 0, ranges: [], offered: false })
			this.flushOffersAndQueue()
		} catch (error) {
			this.setStatus(error instanceof Error ? error.message : '发送失败')
		}
	}

	async acceptAttachment(id: string) {
		const offer = this.pendingOffers.get(id)
		const context = this.context
		if (!offer || !context) return
		let capability = context.localCapability || null
		try {
			if (!capability) capability = await this.detectLocalCapability(offer.attachment.size)
			assertCanReceiveFile(offer.attachment.size, capability)
			this.emit({ type: 'attachment-patch', patch: { id, messageId: offer.messageId, status: 'receiving', progress: 0 } })
			this.emit({ type: 'file-record-patch', id, patch: { status: 'receiving' } })
			const prepared = await this.prepareIncoming(offer, capability)
			const current = { offer, ...prepared }
			this.incoming.set(id, current)
			this.pendingOffers.delete(id)
			this.emit({ type: 'attachment-patch', patch: { id, messageId: offer.messageId, storage: current.engine.kind, progress: offer.attachment.size ? current.received / offer.attachment.size : 1 } })
			this.emit({ type: 'file-record-patch', id, patch: { storage: current.engine.kind } })
			const ranges = await current.engine.getReceivedRanges(current.meta.id)
			this.sendControl({ ...this.controlBase('attachment-accept'), id, messageId: offer.messageId, storage: current.engine.kind, receivedRanges: ranges, receivedBytes: current.received })
			this.setStatus(`正在接收 ${offer.attachment.name}`)
		} catch (error) {
			const reason = isUserCancel(error) ? '已取消下载' : error instanceof Error ? error.message : '当前设备不能接收该文件'
			const status = isUserCancel(error) ? 'cancelled' : 'failed'
			this.pendingOffers.delete(id)
			if (status === 'cancelled') this.cancelledIncoming.set(id, reason)
			this.emit({ type: 'attachment-patch', patch: { id, messageId: offer.messageId, status, error: reason } })
			this.emit({ type: 'file-record-patch', id, patch: { status } })
			this.sendControl({ ...this.controlBase('attachment-cancel'), id, messageId: offer.messageId, reason })
			this.setStatus(reason)
		}
	}

	clearReceivedFile(id: string) {
		const cached = this.receivedCache.get(id)
		if (cached?.url) URL.revokeObjectURL(cached.url)
		if (cached) void cached.engine.cleanup(cached.fileId).catch(() => {})
		this.receivedCache.delete(id)
		this.emit({ type: 'file-record-patch', id, patch: { status: 'cancelled', url: undefined } })
	}

	downloadAttachment(name: string, url: string) {
		downloadUrl(name, url)
	}

	private emit(event: LanConnectionRuntimeEvent) {
		this.listeners.forEach(listener => listener(event))
	}

	private setStatus(message: string) {
		this.emit({ type: 'status', message })
	}

	private isOpen() {
		return Boolean(this.transport?.isOpen())
	}

	private controlBase<T extends LanControlMessage['type']>(type: T, createdAt = Date.now()): { type: T; protocolVersion: typeof LAN_PROTOCOL_VERSION; peerId: string; seq: number; createdAt: number } {
		const peerId = this.context?.session.peerId || ''
		this.seq += 1
		return { type, protocolVersion: LAN_PROTOCOL_VERSION, peerId, seq: this.seq, createdAt }
	}

	private sendControl(message: LanControlMessage) {
		if (!this.transport?.isOpen()) return false
		return this.transport.send(encodeControl(message))
	}

	private async detectLocalCapability(fileSize = 0) {
		const context = this.context
		if (!context) throw new Error('请先连接设备')
		const capability = await detectLanCapability(context.session.peerId, fileSize)
		context.localCapability = capability
		this.emit({ type: 'local-capability', capability })
		return capability
	}

	private async sendLocalCapability() {
		const capability = this.context?.localCapability || await this.detectLocalCapability()
		this.sendControl({ ...capability, ...this.controlBase('capability') })
	}

	private flushOffersAndQueue() {
		if (!this.transport?.isOpen()) return
		this.prepared.forEach(entry => {
			if (entry.offered) return
			const offered = this.sendControl({
				...this.controlBase('attachment-offer', entry.createdAt),
				messageId: entry.file.messageId,
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
				this.emit({ type: 'attachment-patch', patch: { id: entry.file.id, messageId: entry.file.messageId, status: 'offered' } })
				this.setStatus(`等待对方下载 ${entry.file.name}`)
			}
		})
		this.pumpQueue()
	}

	private pumpQueue() {
		if (!this.transport?.isOpen() || this.activeSending) return
		const nextId = this.queue.find(id => this.prepared.get(id)?.accepted)
		if (!nextId) return
		const entry = this.prepared.get(nextId)
		const message = entry?.accepted
		if (!entry || !message) return
		this.queue = this.queue.filter(id => id !== nextId)
		this.activeSending = nextId
		this.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, status: 'sending', progress: entry.file.size ? message.receivedBytes / entry.file.size : 1 } })
		this.setStatus(`正在发送 ${entry.file.name}`)
		let lastProgressBytes = message.receivedBytes
		let lastProgressAt = Date.now()
		void sendPreparedAttachment(this.transport, entry.file, done => {
			const now = Date.now()
			if (done < entry.file.size && done - lastProgressBytes < LAN_LIMITS.progressAckIntervalBytes && now - lastProgressAt < LAN_LIMITS.progressAckIntervalMs) return
			lastProgressBytes = done
			lastProgressAt = now
			this.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, progress: entry.file.size ? done / entry.file.size : 1, status: 'sending' } })
		}, {
			mobile: this.context?.remoteCapability?.platform === 'android' || this.context?.remoteCapability?.platform === 'ios',
			getAckedBytes: () => entry.acked,
			receivedRanges: entry.ranges,
			completeMessage: { ...this.controlBase('attachment-complete'), id: entry.file.id, messageId: entry.file.messageId, sent: entry.file.size, chunkCount: entry.file.chunkCount },
		}).then(() => {
			this.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, progress: 1, status: 'sending' } })
			this.setStatus(`已发送 ${entry.file.name}，等待对方接收`)
		}).catch(error => {
			this.activeSending = null
			if (!this.transport?.isOpen()) {
				if (entry.accepted && !this.queue.includes(message.id)) this.queue.unshift(message.id)
				this.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, status: 'queued' } })
				this.setStatus('连接断了，恢复后会继续')
				return
			}
			this.failAttachment(message.id, message.messageId, error instanceof Error ? error.message : '发送失败')
			this.pumpQueue()
		})
	}

	private completeOutgoing(message: LanAttachmentReceived) {
		this.prepared.delete(message.id)
		this.queue = this.queue.filter(id => id !== message.id)
		this.activeSending = null
		this.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, status: 'complete', progress: 1 } })
		this.emit({ type: 'file-record-patch', id: message.id, patch: { status: 'complete' } })
		this.setStatus('对方已收到')
		this.pumpQueue()
	}

	private async prepareIncoming(message: LanAttachmentOffer, capability: LanCapability | null) {
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
	}

	private async handleOffer(message: LanAttachmentOffer) {
		const context = this.context
		if (!context) return
		let capability = context.localCapability || null
		if (!capability) capability = await this.detectLocalCapability(message.attachment.size)
		try {
			const cancelledReason = this.cancelledIncoming.get(message.attachment.id)
			if (cancelledReason) {
				this.sendControl({ ...this.controlBase('attachment-cancel'), id: message.attachment.id, messageId: message.messageId, reason: cancelledReason })
				return
			}
			const cached = this.receivedCache.get(message.attachment.id)
			if (cached && cached.size === message.attachment.size && cached.chunkCount === message.attachment.chunkCount) {
				const attachment = { ...attachmentFromOffer(message, cached.storage, 1), status: 'complete' as const, url: cached.url, previewUrl: message.attachment.kind === 'image' ? cached.url : undefined }
				this.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
				this.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
				this.confirmReceived(message.attachment.id, message.messageId, cached.size, cached.chunkCount, cached.storage)
				return
			}
			assertCanReceiveFile(message.attachment.size, capability)
			const current = this.incoming.get(message.attachment.id)
			if (current) {
				const ranges = await current.engine.getReceivedRanges(current.meta.id)
				this.sendControl({ ...this.controlBase('attachment-accept'), id: message.attachment.id, messageId: message.messageId, storage: current.engine.kind, receivedRanges: ranges, receivedBytes: current.received })
				return
			}
			this.pendingOffers.set(message.attachment.id, message)
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability)
			const attachment = { ...attachmentFromOffer(message, storage, 0), status: 'offered' as const }
			this.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
			this.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
			this.setStatus(`${message.attachment.name} 等待下载`)
		} catch (error) {
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability)
			const attachment = { ...attachmentFromOffer(message, storage, 0), status: 'failed' as const, error: error instanceof Error ? error.message : '当前设备不能接收该文件' }
			this.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
			this.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
			this.sendControl({ ...this.controlBase('attachment-cancel'), id: message.attachment.id, messageId: message.messageId, reason: error instanceof Error ? error.message : '当前设备不能接收该文件' })
		}
	}

	private async finishIncoming(id: string, messageIdValue: string, sent?: number, chunkCount?: number) {
		const current = this.incoming.get(id)
		if (!current) return
		await this.chunkWriteQueue
		const manifest = await current.engine.getManifest(current.meta.id)
		if (!manifest) return this.failAttachment(id, messageIdValue, '接收失败，请重新发送')
		if (typeof sent === 'number' && sent !== current.offer.attachment.size) return this.failAttachment(id, messageIdValue, '文件信息不一致，请重新发送')
		if (typeof chunkCount === 'number' && chunkCount !== manifest.receivedChunks) return this.failAttachment(id, messageIdValue, '接收不完整，请重新发送')
		if (manifest.receivedBytes !== current.offer.attachment.size || manifest.receivedChunks !== current.offer.attachment.chunkCount) return this.failAttachment(id, messageIdValue, `接收不完整：${formatBytes(manifest.receivedBytes)} / ${formatBytes(current.offer.attachment.size)}`)
		const finalized = await current.engine.finalize(current.meta)
		this.emit({ type: 'attachment-patch', patch: { id, messageId: messageIdValue, status: 'complete', progress: 1, url: finalized.url, previewUrl: current.offer.attachment.kind === 'image' ? finalized.url : undefined } })
		this.emit({ type: 'file-record-patch', id, patch: { status: 'complete', url: finalized.url } })
		this.receivedCache.set(id, { engine: current.engine, fileId: current.meta.id, messageId: messageIdValue, size: current.offer.attachment.size, chunkCount: manifest.receivedChunks, storage: current.engine.kind, url: finalized.url })
		this.progressAck.delete(id)
		this.confirmReceived(id, messageIdValue, current.offer.attachment.size, manifest.receivedChunks, current.engine.kind)
		this.incoming.delete(id)
		if (finalized.url) this.emit({ type: 'download-ready', name: current.offer.attachment.name, url: finalized.url })
		this.setStatus(finalized.directSave ? '接收完成，文件已保存' : '接收完成，可在文件页查看')
	}

	private queueIncomingChunk(id: string, chunkIndex: number, bytes: Uint8Array) {
		this.chunkWriteQueue = this.chunkWriteQueue.then(async () => {
			const current = this.incoming.get(id)
			if (!current) return
			if (chunkIndex < 0 || chunkIndex >= current.offer.attachment.chunkCount) throw new Error('接收失败，请重新发送')
			const manifest = await current.engine.writeChunk(current.meta, chunkIndex, bytes)
			if (manifest.receivedBytes > current.offer.attachment.size) throw new Error('接收失败，请重新发送')
			current.received = manifest.receivedBytes
			current.chunkCount = manifest.receivedChunks
			const done = current.received >= current.offer.attachment.size || current.chunkCount >= current.offer.attachment.chunkCount
			if (this.shouldReportProgress(id, current.received, current.offer.attachment.size, done)) {
				const progress = current.offer.attachment.size ? current.received / current.offer.attachment.size : 1
				this.emit({ type: 'attachment-patch', patch: { id, messageId: current.offer.messageId, status: 'receiving', progress } })
				this.emit({ type: 'file-record-patch', id, patch: { status: 'receiving' } })
				this.sendControl({ ...this.controlBase('attachment-progress'), id, messageId: current.offer.messageId, received: current.received, chunkCount: current.chunkCount, storage: current.engine.kind })
			}
		}).catch(error => {
			const current = this.incoming.get(id)
			if (current) this.failAttachment(id, current.offer.messageId, error instanceof Error ? error.message : '接收失败')
		})
	}

	private shouldReportProgress(id: string, received: number, total: number, force = false) {
		const now = Date.now()
		const previous = this.progressAck.get(id)
		if (force || received >= total || !previous || received - previous.bytes >= LAN_LIMITS.progressAckIntervalBytes || now - previous.ts >= LAN_LIMITS.progressAckIntervalMs) {
			this.progressAck.set(id, { bytes: received, ts: now })
			return true
		}
		return false
	}

	private async handleControl(message: LanControlMessage) {
		if ('protocolVersion' in message && message.protocolVersion !== LAN_PROTOCOL_VERSION) return this.setStatus('双方页面不一致，请刷新后重试')
		if (message.type === 'capability') {
			if (this.context) this.context.remoteCapability = message
			this.emit({ type: 'remote-capability', capability: message })
			this.setStatus('已连接，可以发送消息和文件')
			this.flushOffersAndQueue()
			return
		}
		if (message.type === 'chat-message') return this.emit({ type: 'message-upsert', message: { id: message.id, direction: 'in', kind: 'text', text: message.text, attachments: [], status: 'received', createdAt: message.createdAt, peerId: message.peerId } })
		if (message.type === 'attachment-offer') return void (await this.handleOffer(message))
		if (message.type === 'attachment-accept') {
			const entry = this.prepared.get(message.id)
			if (!entry) return
			entry.accepted = message
			entry.ranges = message.receivedRanges
			entry.acked = message.receivedBytes
			if (!this.queue.includes(message.id) && this.activeSending !== message.id) this.queue.push(message.id)
			this.pumpQueue()
			return
		}
		if (message.type === 'attachment-progress') {
			const entry = this.prepared.get(message.id)
			if (entry) {
				entry.acked = Math.max(entry.acked, message.received)
				this.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, progress: entry.file.size ? message.received / entry.file.size : 1, status: 'sending' } })
			}
			return
		}
		if (message.type === 'attachment-complete') return void (await this.finishIncoming(message.id, message.messageId, message.sent, message.chunkCount))
		if (message.type === 'attachment-received') return this.completeOutgoing(message)
		if (message.type === 'attachment-cancel') {
			this.failAttachment(message.id, message.messageId, message.reason || '已取消', false)
			this.pumpQueue()
			return
		}
		if (message.type === 'resume-query') {
			const attachments = await Promise.all(message.ids.map(async id => {
				const cached = this.receivedCache.get(id)
				if (cached) {
					this.confirmReceived(id, cached.messageId, cached.size, cached.chunkCount, cached.storage)
					return null
				}
				const current = this.incoming.get(id)
				return current ? { id, messageId: current.offer.messageId, receivedRanges: await current.engine.getReceivedRanges(current.meta.id), receivedBytes: current.received, storage: current.engine.kind } : null
			}))
			this.sendControl({ ...this.controlBase('resume-state'), attachments: attachments.filter((item): item is NonNullable<typeof item> => Boolean(item)) })
			return
		}
		if (message.type === 'resume-state') for (const item of message.attachments) {
			const entry = this.prepared.get(item.id)
			if (entry) {
				entry.ranges = item.receivedRanges
				entry.acked = item.receivedBytes
				if (entry.accepted && !this.queue.includes(item.id) && this.activeSending !== item.id) this.queue.push(item.id)
			}
		}
	}

	private confirmReceived(id: string, messageIdValue: string, size: number, chunkCount: number, storage: TransferFileMeta['storage']) {
		this.sendControl({ ...this.controlBase('attachment-received'), id, messageId: messageIdValue, received: size, expected: size, chunkCount, storage })
	}

	private failAttachment(id: string, messageIdValue: string | undefined, reason: string, notifyPeer = true) {
		this.emit({ type: 'attachment-patch', patch: { id, messageId: messageIdValue, status: 'failed', error: reason } })
		this.emit({ type: 'file-record-patch', id, patch: { status: 'failed' } })
		if (notifyPeer) this.sendControl({ ...this.controlBase('attachment-cancel'), id, messageId: messageIdValue, reason })
		this.prepared.delete(id)
		if (this.activeSending === id) this.activeSending = null
		this.queue = this.queue.filter(item => item !== id)
		this.progressAck.delete(id)
		this.cleanupIncoming(id)
		this.setStatus(reason)
	}

	private cleanupIncoming(id: string) {
		const current = this.incoming.get(id)
		if (!current) return
		this.incoming.delete(id)
		void this.chunkWriteQueue.then(() => current.engine.cleanup(current.meta.id)).catch(() => {})
	}
}
