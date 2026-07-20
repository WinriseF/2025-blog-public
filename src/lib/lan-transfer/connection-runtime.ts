import { assertCanReceiveFile, detectLanCapability, selectStorageForFile } from './capability'
import {
	decodeFrame,
	encodeControl,
	formatBytes,
	imagePreviewUrl,
	messageId,
	prepareLanAttachment,
} from './file-transfer'
import { LanAttachmentSendScheduler } from './attachment-send-scheduler'
import { LanNativeFileRuntime } from './native-file-runtime'
import type { LanNativeLocalAgentPort, LanNativePeerBulkPort } from './native-agent/ports'
import type { LanConnectionTransport } from './transport-types'
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
	type LanChatHistoryMessage,
	type LanChatMessage,
	type LanControlMessage,
	type LanFileRecord,
	type LanNativeAgentTicket,
	type LanSession,
	type PreparedLanAttachment,
} from './types'

type IncomingAttachment = { offer: LanAttachmentOffer; meta: TransferFileMeta; engine: LanStorageEngine; received: number; chunkCount: number }
type PreparedEntry = { file: PreparedLanAttachment; createdAt: number; acked: number; ranges: Array<[number, number]>; offered: boolean; accepted?: LanAttachmentAccept }
type CachedReceivedFile = { engine: LanStorageEngine; fileId: string; messageId: string; size: number; chunkCount: number; storage: TransferFileMeta['storage']; url?: string }
type ProgressCheckpoint = { bytes: number; ts: number }
type TransferSample = { bytes: number; ts: number; speedBps: number }
type ResumeSync = { id: string; epoch: number; generation: number; ids: Set<string>; timer?: ReturnType<typeof setTimeout> }

type RuntimeContext = {
	session: LanSession
	remotePeerName?: string
	remoteCapability?: LanCapability | null
	localCapability?: LanCapability | null
	getHistory?: () => LanChatMessage[]
	issueNativeAgentTicket?: (peerDeviceId: string) => Promise<LanNativeAgentTicket>
	getNativeLocalAgentPort: () => LanNativeLocalAgentPort | null
	remoteDeviceId: string
}

type SendFilesOptions = {
	kind?: LanAttachmentKind
	durationMs?: number
}

type AttachmentPatch = Partial<LanAttachment> & { id: string; messageId?: string }
type MessagePatch = Partial<Pick<LanChatMessage, 'status' | 'error'>> & { id: string }

export type LanConnectionRuntimeEvent =
	| { type: 'message-upsert'; message: LanChatMessage }
	| { type: 'message-patch'; patch: MessagePatch }
	| { type: 'history-merge'; messages: LanChatMessage[] }
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

function historyMessageForSync(message: LanChatMessage): LanChatHistoryMessage {
	return {
		...message,
		attachments: message.attachments.map(({ url, previewUrl, speedBps, etaSeconds, phase, ...attachment }) => attachment),
	}
}

function invertDirection(direction: LanChatMessage['direction']) {
	if (direction === 'out') return 'in'
	if (direction === 'in') return 'out'
	return 'system'
}

function historyMessageFromRemote(message: LanChatHistoryMessage): LanChatMessage {
	const direction = invertDirection(message.direction)
	return {
		...message,
		direction,
		status: direction === 'in' ? 'received' : direction === 'out' ? 'sent' : 'received',
		attachments: message.attachments.map(attachment => ({
			...attachment,
			direction: attachment.direction === 'out' ? 'in' : 'out',
			speedBps: undefined,
			etaSeconds: undefined,
		})),
	}
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

function receiveStorageCandidates(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null, allowDirectFile = true) {
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
	if (fallback !== 'file' || allowDirectFile) {
		if (fallback !== 'memory' || size <= LAN_LIMITS.memoryMaxBytes) add(fallback)
	}
	return candidates
}

function chooseReceiveStorage(size: number, requested: TransferFileMeta['storage'], capability: LanCapability | null, allowDirectFile = true) {
	return receiveStorageCandidates(size, requested, capability, allowDirectFile)[0] || 'memory'
}

function isUserCancel(error: unknown) {
	const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : ''
	return name === 'AbortError' || name === 'NotAllowedError'
}

function isInlineMediaKind(kind: LanAttachmentKind) {
	return kind === 'image' || kind === 'voice'
}

function isMobileCapability(capability?: LanCapability | null) {
	return capability?.platform === 'android' || capability?.platform === 'ios'
}

function clampBytes(bytes: number, total: number) {
	return Math.max(0, Math.min(total, bytes))
}

export class LanConnectionRuntime {
	private listeners = new Set<RuntimeListener>()
	private transport: LanConnectionTransport | null = null
	private transportEpoch = 0
	private context: RuntimeContext | null = null
	private seq = 0
	private prepared = new Map<string, PreparedEntry>()
	private incoming = new Map<string, IncomingAttachment>()
	private pendingOffers = new Map<string, LanAttachmentOffer>()
	private receivedCache = new Map<string, CachedReceivedFile>()
	private cancelledIncoming = new Map<string, string>()
	private progressAck = new Map<string, ProgressCheckpoint>()
	private transferSamples = new Map<string, TransferSample>()
	private outgoingTextIds = new Set<string>()
	private deliveredTextIds = new Set<string>()
	private resumeSync: ResumeSync | null = null
	private chunkWriteQueue: Promise<void> = Promise.resolve()
	private finalizingIncoming = new Map<string, Promise<void>>()
	private outgoingObjectUrls: string[] = []
	private pendingNativeTickets = new Map<string, { resolve: (ticket: LanNativeAgentTicket) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
	private destroyed = false
	private native: LanNativeFileRuntime
	private sender = new LanAttachmentSendScheduler({
		createCompleteMessage: file => ({ ...this.controlBase('attachment-complete'), id: file.id, messageId: file.messageId, sent: file.size, chunkCount: file.chunkCount }),
		onTaskStarted: file => {
			const entry = this.prepared.get(file.id)
			if (!entry) return
			this.resetTransferSample(file.id, entry.acked)
			this.emit({ type: 'attachment-patch', patch: { ...this.transferPatch(file.id, file.messageId, 'sending', entry.acked, file.size), phase: 'transferring' } })
			this.setStatus(`正在发送 ${file.name}`)
		},
		onTaskConfirming: file => {
			this.emit({ type: 'attachment-patch', patch: { id: file.id, messageId: file.messageId, status: 'sending', phase: 'confirming', speedBps: undefined, etaSeconds: undefined } })
			this.setStatus(`已发送 ${file.name}，等待对方保存确认`)
		},
		onTaskError: (file, reason) => this.failAttachment(file.id, file.messageId, reason),
		onTransportStalled: reason => this.setStatus(reason),
	})

	constructor(nativePeerBulk: LanNativePeerBulkPort) {
		this.native = new LanNativeFileRuntime({
			context: () => this.context ? {
				localDeviceId: this.context.session.localPeer.deviceId,
				peerDeviceId: this.context.remoteDeviceId,
				localCapability: this.context.localCapability || null,
				remoteCapability: this.context.remoteCapability || null,
				localPort: this.context.getNativeLocalAgentPort(),
			} : null,
			peerBulk: nativePeerBulk,
			controlBase: (type, createdAt) => this.controlBase(type, createdAt),
			sendControl: message => this.sendControl(message),
			prepareStorage: async offer => {
				const capability = this.context?.localCapability || await this.detectLocalCapability(offer.attachment.size)
				assertCanReceiveFile(offer.attachment.size, capability)
				const prepared = await this.prepareIncoming(offer, capability, true)
				return { engine: prepared.engine, meta: prepared.meta }
			},
			createAttachment: (messageIdValue, createdAt, direction, attachment) => {
				this.emit({ type: 'attachment-upsert', message: messageBase(messageIdValue, direction, createdAt, this.context?.session.instanceId), attachment })
				this.emit({ type: 'file-record-upsert', record: fileRecord(messageIdValue, attachment, this.context?.remotePeerName) })
			},
			patchAttachment: (id, messageIdValue, patch) => this.emit({ type: 'attachment-patch', patch: { id, messageId: messageIdValue, ...patch } }),
			patchFile: (id, patch) => this.emit({ type: 'file-record-patch', id, patch }),
			downloadReady: (name, url) => this.emit({ type: 'download-ready', name, url }),
			status: message => this.setStatus(message),
		})
	}

	subscribe(listener: RuntimeListener) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	hasActiveTransfer() {
		return this.incoming.size > 0 || this.sender.hasPendingTransfer() || this.native.hasActiveTransfer()
	}

	attachTransport(transport: LanConnectionTransport, context: RuntimeContext) {
		if (this.destroyed) return
		this.transportEpoch += 1
		this.transport = transport
		this.context = context
		this.sender.attach(transport, isMobileCapability(context.localCapability) || isMobileCapability(context.remoteCapability))
		this.native.attach()
		if (context.localCapability) this.emit({ type: 'local-capability', capability: context.localCapability })
		if (context.remoteCapability) this.emit({ type: 'remote-capability', capability: context.remoteCapability })
		this.resumeAfterConnect()
	}

	detachTransport() {
		this.sender.detach()
		this.clearResumeSync()
		this.transportEpoch += 1
		this.transport = null
	}

	updateLocalCapability(capability: LanCapability) {
		if (!this.context) return
		this.context.localCapability = capability
		if (this.isOpen()) this.sendControl({ ...capability, ...this.controlBase('capability') })
	}

	pauseTransport() {
		this.sender.pause()
	}

	resumeTransport() {
		if (this.isOpen()) this.sender.resume()
	}

	destroy() {
		if (this.destroyed) return
		this.destroyed = true
		this.reset()
		this.listeners.clear()
	}

	reset() {
		this.detachTransport()
		const pendingWrites = this.chunkWriteQueue
		const incoming = Array.from(this.incoming.values())
		this.incoming.clear()
		void pendingWrites.then(() => Promise.all(incoming.map(item => item.engine.cleanup(item.meta.id)))).catch(() => {})
		this.receivedCache.forEach(file => {
			if (file.url) URL.revokeObjectURL(file.url)
			void file.engine.cleanup(file.fileId).catch(() => {})
		})
		this.receivedCache.clear()
		this.cancelledIncoming.clear()
		this.progressAck.clear()
		this.transferSamples.clear()
		this.outgoingTextIds.clear()
		this.deliveredTextIds.clear()
		this.pendingOffers.clear()
		this.prepared.clear()
		this.sender.clear()
		this.clearResumeSync()
		this.chunkWriteQueue = Promise.resolve()
		this.finalizingIncoming.clear()
		this.context = null
		this.outgoingObjectUrls.forEach(url => URL.revokeObjectURL(url))
		this.outgoingObjectUrls = []
		this.pendingNativeTickets.forEach(pending => {
			clearTimeout(pending.timer)
			pending.reject(new Error('连接已关闭'))
		})
		this.pendingNativeTickets.clear()
		this.native.reset()
	}

	handleFrame(data: unknown) {
		const frame = decodeFrame(data)
		if (!frame) return
		if (frame.kind === 'control') return void this.handleControl(frame.message).catch(error => this.setStatus(error instanceof Error ? error.message : '发送失败'))
		this.queueIncomingChunk(frame.id, frame.index, frame.bytes)
	}

	resumeAfterConnect() {
		if (!this.isOpen()) return
		const epoch = this.transportEpoch
		const transport = this.transport
		if (!transport) return
		this.sender.pause()
		this.clearResumeSync()
		this.prepared.forEach(entry => {
			entry.offered = false
		})
		const ids = new Set(this.prepared.keys())
		const resumeId = messageId()
		if (ids.size) {
			this.resumeSync = { id: resumeId, epoch, generation: transport.generation, ids }
			this.setStatus('正在同步文件断点')
		}
		void this.sendLocalCapability(epoch).then(() => {
			if (epoch !== this.transportEpoch || this.transport !== transport) return
			this.sendChatHistory()
			if (!ids.size) return this.flushOffersAndQueue()
			const sent = this.sendControl({ ...this.controlBase('resume-query'), resumeId, transportGeneration: transport.generation, transportEpoch: epoch, ids: Array.from(ids) })
			const sync = this.resumeSync
			if (!sync || sync.id !== resumeId) return
			if (!sent) this.setStatus('断点同步失败，正在等待重试')
			sync.timer = setTimeout(() => {
				if (this.resumeSync?.id !== resumeId) return
				this.prepared.forEach(entry => {
					this.sender.remove(entry.file.id)
					entry.accepted = undefined
					entry.ranges = []
					entry.acked = 0
					entry.offered = false
				})
				this.clearResumeSync()
				this.setStatus('断点同步超时，正在重新确认文件进度')
				this.flushOffersAndQueue()
			}, 15_000)
		}).catch(() => {
			if (epoch === this.transportEpoch) this.setStatus('断点同步失败，正在等待连接恢复')
		})
	}

	sendText(text: string) {
		const trimmed = text.trim()
		const context = this.context
		if (!trimmed) return
		if (!context || !this.isOpen()) return this.setStatus('请先连接设备')
		const id = messageId()
		const createdAt = Date.now()
		this.outgoingTextIds.add(id)
		this.emit({ type: 'message-upsert', message: { id, direction: 'out', kind: 'text', text: trimmed, attachments: [], status: 'queued', createdAt, peerId: context.session.instanceId } })
		const sent = this.sendControl({ ...this.controlBase('chat-message', createdAt), id, text: trimmed })
		this.emit({ type: 'message-patch', patch: { id, status: sent ? 'sent' : 'failed', error: sent ? undefined : '发送失败，连接恢复后会重试' } })
		if (!sent) this.setStatus('发送失败，连接恢复后会重试')
	}

	async sendFiles(files: File[], options: SendFilesOptions = {}) {
		const context = this.context
		if (!files.length) return
		if (!context || !this.isOpen()) return this.setStatus('请先连接设备')
		const remote = context.remoteCapability || null
		const webFiles = options.kind === 'image' || options.kind === 'voice' ? files : await this.native.trySendBrowserFiles(files)
		if (!webFiles.length) return
		const transport = this.transport
		const createdAt = Date.now()
		const id = messageId()
		try {
			if (!transport) throw new Error('请先连接设备')
			const chunkSize = await transport.negotiateChunkSize(remote?.limits.recommendedChunkSize)
			if (this.transport !== transport || !transport.isOpen()) throw new Error('连接已断开，请重新发送')
			const prepared = webFiles.map(file => prepareLanAttachment(file, {
				messageId: id,
				kind: options.kind,
				chunkSize,
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
			if (this.destroyed) {
				attachments.forEach(attachment => attachment.url && URL.revokeObjectURL(attachment.url))
				return
			}
			this.emit({ type: 'message-upsert', message: { id, direction: 'out', kind: 'attachments', attachments, status: 'queued', createdAt, peerId: context.session.instanceId } })
			for (const attachment of attachments) this.emit({ type: 'file-record-upsert', record: fileRecord(id, attachment, context.remotePeerName) })
			for (const file of prepared) this.prepared.set(file.id, { file, createdAt, acked: 0, ranges: [], offered: false })
			this.flushOffersAndQueue()
		} catch (error) {
			this.setStatus(error instanceof Error ? error.message : '发送失败')
		}
	}

	async acceptAttachment(id: string) {
		if (await this.native.accept(id)) return
		await this.receivePendingAttachment(id, false)
	}

	selectNativeFiles() {
		return this.native.selectAgentFiles()
	}

	private async receivePendingAttachment(id: string, autoInlineMedia: boolean) {
		if (this.destroyed) return
		const offer = this.pendingOffers.get(id)
		const context = this.context
		if (!offer || !context) return
		let capability = context.localCapability || null
		try {
			if (!capability) capability = await this.detectLocalCapability(offer.attachment.size)
			if (autoInlineMedia && offer.attachment.size > LAN_LIMITS.memoryMaxBytes && !capability.storage.opfs && !capability.storage.indexedDB) throw new Error('当前设备不能自动缓存该媒体')
			assertCanReceiveFile(offer.attachment.size, capability)
			this.resetTransferSample(id, 0)
			this.emit({ type: 'attachment-patch', patch: this.transferPatch(id, offer.messageId, 'receiving', 0, offer.attachment.size) })
			this.emit({ type: 'file-record-patch', id, patch: { status: 'receiving' } })
			const prepared = await this.prepareIncoming(offer, capability, !autoInlineMedia)
			if (this.destroyed) {
				await prepared.engine.cleanup(prepared.meta.id).catch(() => {})
				return
			}
			const current = { offer, ...prepared }
			this.incoming.set(id, current)
			this.pendingOffers.delete(id)
			this.resetTransferSample(id, current.received)
			this.emit({ type: 'attachment-patch', patch: { ...this.transferPatch(id, offer.messageId, 'receiving', current.received, offer.attachment.size), storage: current.engine.kind } })
			this.emit({ type: 'file-record-patch', id, patch: { storage: current.engine.kind } })
			const snapshot = await this.checkpointIncoming(current)
			if (!snapshot) throw new Error('无法读取接收进度')
			this.sendControl({ ...this.controlBase('attachment-accept'), id, messageId: offer.messageId, storage: current.engine.kind, receivedRanges: snapshot.receivedRanges, receivedBytes: snapshot.receivedBytes })
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

	private emit(event: LanConnectionRuntimeEvent) {
		if (this.destroyed) return
		this.listeners.forEach(listener => listener(event))
	}

	private setStatus(message: string) {
		this.emit({ type: 'status', message })
	}

	private clearResumeSync() {
		if (this.resumeSync?.timer) clearTimeout(this.resumeSync.timer)
		this.resumeSync = null
	}

	private resetTransferSample(id: string, bytes = 0) {
		this.transferSamples.set(id, { bytes, ts: Date.now(), speedBps: 0 })
	}

	private transferStats(id: string, bytes: number, total: number) {
		const transferredBytes = clampBytes(bytes, total)
		const now = Date.now()
		const previous = this.transferSamples.get(id)
		let speedBps = previous?.speedBps || 0
		if (!previous || transferredBytes < previous.bytes) {
			this.transferSamples.set(id, { bytes: transferredBytes, ts: now, speedBps: 0 })
			return { transferredBytes, speedBps: undefined, etaSeconds: undefined }
		}
		const deltaBytes = transferredBytes - previous.bytes
		const deltaSeconds = (now - previous.ts) / 1000
		if (deltaBytes > 0 && deltaSeconds >= 0.25) {
			const instantSpeed = deltaBytes / deltaSeconds
			speedBps = speedBps ? speedBps * 0.35 + instantSpeed * 0.65 : instantSpeed
			this.transferSamples.set(id, { bytes: transferredBytes, ts: now, speedBps })
		}
		const etaSeconds = speedBps > 0 && transferredBytes < total ? (total - transferredBytes) / speedBps : undefined
		return { transferredBytes, speedBps: speedBps || undefined, etaSeconds }
	}

	private transferPatch(id: string, messageId: string | undefined, status: LanAttachment['status'], bytes: number, total: number): AttachmentPatch {
		const stats = this.transferStats(id, bytes, total)
		return {
			id,
			messageId,
			status,
			progress: total ? stats.transferredBytes / total : 1,
			...stats,
		}
	}

	private isOpen() {
		return Boolean(this.transport?.isOpen())
	}

	private controlBase<T extends LanControlMessage['type']>(type: T, createdAt = Date.now()): { type: T; protocolVersion: typeof LAN_PROTOCOL_VERSION; peerId: string; seq: number; createdAt: number } {
		const peerId = this.context?.session.instanceId || ''
		this.seq += 1
		return { type, protocolVersion: LAN_PROTOCOL_VERSION, peerId, seq: this.seq, createdAt }
	}

	private sendControl(message: LanControlMessage) {
		if (!this.transport?.isOpen()) return false
		return this.transport.send(encodeControl(message))
	}

	private sendChatHistory() {
		const messages = this.context?.getHistory?.() || []
		if (!messages.length) return
		this.sendControl({ ...this.controlBase('chat-history'), messages: messages.map(historyMessageForSync) })
	}

	private sendChatReceipt(messageIds: string[]) {
		const ids = Array.from(new Set(messageIds.filter(Boolean)))
		if (ids.length) this.sendControl({ ...this.controlBase('chat-receipt'), messageIds: ids })
	}

	private markTextDelivered(messageIds: string[]) {
		for (const id of new Set(messageIds)) {
			if (!this.outgoingTextIds.has(id) || this.deliveredTextIds.has(id)) continue
			this.deliveredTextIds.add(id)
			this.emit({ type: 'message-patch', patch: { id, status: 'delivered', error: undefined } })
		}
	}

	private async detectLocalCapability(fileSize = 0) {
		const context = this.context
		if (!context) throw new Error('请先连接设备')
		const capability = await detectLanCapability(context.session.instanceId, fileSize)
		context.localCapability = capability
		this.sender.setMobile(isMobileCapability(capability) || isMobileCapability(context.remoteCapability))
		this.emit({ type: 'local-capability', capability })
		return capability
	}

	private async sendLocalCapability(epoch = this.transportEpoch) {
		const capability = this.context?.localCapability || await this.detectLocalCapability()
		if (epoch !== this.transportEpoch) return
		this.sendControl({ ...capability, ...this.controlBase('capability') })
	}

	private flushOffersAndQueue() {
		if (!this.transport?.isOpen() || this.resumeSync) return
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
					dataPlane: entry.file.dataPlane,
				},
			})
			if (offered) {
				entry.offered = true
				this.emit({ type: 'attachment-patch', patch: { id: entry.file.id, messageId: entry.file.messageId, status: 'offered' } })
				this.setStatus(`等待对方下载 ${entry.file.name}`)
			}
		})
		this.sender.resume()
	}

	requestNativeAgentTicket() {
		if (!this.context || !this.isOpen()) return Promise.reject(new Error('请先连接加速电脑'))
		const requestId = messageId()
		return new Promise<LanNativeAgentTicket>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingNativeTickets.delete(requestId)
				reject(new Error('获取极速通道凭据超时'))
			}, 10_000)
			this.pendingNativeTickets.set(requestId, { resolve, reject, timer })
			if (!this.sendControl({ ...this.controlBase('native-agent-ticket-request'), requestId })) {
				clearTimeout(timer)
				this.pendingNativeTickets.delete(requestId)
				reject(new Error('无法向加速电脑请求凭据'))
			}
		})
	}

	private completeOutgoing(message: LanAttachmentReceived) {
		const entry = this.prepared.get(message.id)
		if (!entry || message.messageId !== entry.file.messageId) return
		if (message.received !== entry.file.size || message.expected !== entry.file.size || message.chunkCount !== entry.file.chunkCount) {
			this.failAttachment(message.id, message.messageId, '接收结果不一致，请重新发送')
			return
		}
		this.sender.remove(message.id)
		this.prepared.delete(message.id)
		this.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, status: 'complete', progress: 1, transferredBytes: entry?.file.size || message.received || message.expected, speedBps: undefined, etaSeconds: undefined, phase: undefined } })
		this.emit({ type: 'file-record-patch', id: message.id, patch: { status: 'complete' } })
		this.transferSamples.delete(message.id)
		this.setStatus('对方已收到')
	}

	private async checkpointIncoming(current: IncomingAttachment) {
		await this.chunkWriteQueue
		if (this.destroyed || this.incoming.get(current.meta.id) !== current) return null
		const manifest = await current.engine.checkpoint(current.meta)
		if (!manifest || this.destroyed || this.incoming.get(current.meta.id) !== current) return null
		current.received = manifest.receivedBytes
		current.chunkCount = manifest.receivedChunks
		return {
			receivedBytes: manifest.receivedBytes,
			receivedChunks: manifest.receivedChunks,
			receivedRanges: manifest.receivedRanges.map(range => [...range] as [number, number]),
		}
	}

	private async prepareIncoming(message: LanAttachmentOffer, capability: LanCapability | null, allowDirectFile = true) {
		const candidates = receiveStorageCandidates(message.attachment.size, message.attachment.suggestedStorage, capability, allowDirectFile)
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
		if (this.destroyed) return
		if (this.native.handleOffer(message)) return
		const context = this.context
		if (!context) return
		let capability = context.localCapability || null
		if (!capability) capability = await this.detectLocalCapability(message.attachment.size)
		if (this.destroyed) return
		try {
			const cancelledReason = this.cancelledIncoming.get(message.attachment.id)
			if (cancelledReason) {
				this.sendControl({ ...this.controlBase('attachment-cancel'), id: message.attachment.id, messageId: message.messageId, reason: cancelledReason })
				return
			}
			await this.finalizingIncoming.get(message.attachment.id)?.catch(() => {})
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
				const snapshot = await this.checkpointIncoming(current).catch(() => null)
				if (!snapshot) return
				this.sendControl({ ...this.controlBase('attachment-accept'), id: message.attachment.id, messageId: message.messageId, storage: current.engine.kind, receivedRanges: snapshot.receivedRanges, receivedBytes: snapshot.receivedBytes })
				return
			}
			this.pendingOffers.set(message.attachment.id, message)
			const inlineMedia = isInlineMediaKind(message.attachment.kind)
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability, !inlineMedia)
			const attachment = { ...attachmentFromOffer(message, storage, 0), status: 'offered' as const }
			this.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
			this.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
			if (inlineMedia) {
				this.setStatus(`正在缓存 ${message.attachment.kind === 'image' ? '图片' : '语音'}`)
				void this.receivePendingAttachment(message.attachment.id, true)
				return
			}
			this.setStatus(`${message.attachment.name} 等待下载`)
		} catch (error) {
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability)
			const attachment = { ...attachmentFromOffer(message, storage, 0), status: 'failed' as const, error: error instanceof Error ? error.message : '当前设备不能接收该文件' }
			this.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
			this.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
			this.sendControl({ ...this.controlBase('attachment-cancel'), id: message.attachment.id, messageId: message.messageId, reason: error instanceof Error ? error.message : '当前设备不能接收该文件' })
		}
	}

	private finishIncoming(id: string, messageIdValue: string, sent: number, chunkCount: number) {
		const running = this.finalizingIncoming.get(id)
		if (running) return running
		const cached = this.receivedCache.get(id)
		if (cached && cached.messageId === messageIdValue && cached.size === sent && cached.chunkCount === chunkCount) {
			this.confirmReceived(id, messageIdValue, cached.size, cached.chunkCount, cached.storage)
			return Promise.resolve()
		}
		let task!: Promise<void>
		task = this.finalizeIncoming(id, messageIdValue, sent, chunkCount).catch(error => {
			if (this.incoming.has(id)) this.failAttachment(id, messageIdValue, error instanceof Error ? error.message : '文件保存失败')
		}).finally(() => {
			if (this.finalizingIncoming.get(id) === task) this.finalizingIncoming.delete(id)
		})
		this.finalizingIncoming.set(id, task)
		return task
	}

	private async finalizeIncoming(id: string, messageIdValue: string, sent: number, chunkCount: number) {
		const current = this.incoming.get(id)
		if (!current) return
		await this.chunkWriteQueue
		if (this.destroyed || this.incoming.get(id) !== current) return
		const manifest = await current.engine.getManifest(current.meta.id)
		if (this.destroyed || this.incoming.get(id) !== current) return
		if (!manifest) return this.failAttachment(id, messageIdValue, '接收失败，请重新发送')
		if (sent !== current.offer.attachment.size) return this.failAttachment(id, messageIdValue, '文件信息不一致，请重新发送')
		if (chunkCount !== manifest.receivedChunks) return this.failAttachment(id, messageIdValue, '接收不完整，请重新发送')
		if (manifest.receivedBytes !== current.offer.attachment.size || manifest.receivedChunks !== current.offer.attachment.chunkCount) return this.failAttachment(id, messageIdValue, `接收不完整：${formatBytes(manifest.receivedBytes)} / ${formatBytes(current.offer.attachment.size)}`)
		const finalized = await current.engine.finalize(current.meta)
		if (this.destroyed || this.incoming.get(id) !== current) {
			if (finalized.url) URL.revokeObjectURL(finalized.url)
			await current.engine.cleanup(current.meta.id).catch(() => {})
			return
		}
		const inlineMedia = isInlineMediaKind(current.offer.attachment.kind)
		this.emit({ type: 'attachment-patch', patch: { id, messageId: messageIdValue, status: 'complete', progress: 1, transferredBytes: current.offer.attachment.size, speedBps: undefined, etaSeconds: undefined, url: finalized.url, previewUrl: current.offer.attachment.kind === 'image' ? finalized.url : undefined } })
		this.emit({ type: 'file-record-patch', id, patch: { status: 'complete', url: finalized.url } })
		this.receivedCache.set(id, { engine: current.engine, fileId: current.meta.id, messageId: messageIdValue, size: current.offer.attachment.size, chunkCount: manifest.receivedChunks, storage: current.engine.kind, url: finalized.url })
		this.progressAck.delete(id)
		this.transferSamples.delete(id)
		this.confirmReceived(id, messageIdValue, current.offer.attachment.size, manifest.receivedChunks, current.engine.kind)
		this.incoming.delete(id)
		if (finalized.url && !inlineMedia) this.emit({ type: 'download-ready', name: current.offer.attachment.name, url: finalized.url })
		this.setStatus(inlineMedia ? '媒体已缓存' : finalized.directSave ? '接收完成，文件已保存' : '接收完成，可在文件页查看')
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
				this.emit({ type: 'attachment-patch', patch: this.transferPatch(id, current.offer.messageId, 'receiving', current.received, current.offer.attachment.size) })
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
		if (this.destroyed) return
		if ('protocolVersion' in message && message.protocolVersion !== LAN_PROTOCOL_VERSION) return this.setStatus('双方页面不一致，请刷新后重试')
		if (message.type === 'capability') {
			if (this.context) this.context.remoteCapability = message
			this.sender.setMobile(isMobileCapability(this.context?.localCapability) || isMobileCapability(message))
			this.emit({ type: 'remote-capability', capability: message })
			this.setStatus(this.resumeSync ? '已连接，正在同步文件断点' : '已连接，可以发送消息和文件')
			this.flushOffersAndQueue()
			return
		}
		if (message.type === 'native-agent-ticket-request') {
			const context = this.context
			if (!context?.issueNativeAgentTicket) {
				this.sendControl({ ...this.controlBase('native-agent-ticket-response'), requestId: message.requestId, error: '本机加速组件未连接' })
				return
			}
			try {
				const ticket = await context.issueNativeAgentTicket(context.remoteDeviceId)
				this.sendControl({ ...this.controlBase('native-agent-ticket-response'), requestId: message.requestId, ticket })
			} catch (error) {
				this.sendControl({ ...this.controlBase('native-agent-ticket-response'), requestId: message.requestId, error: error instanceof Error ? error.message : '无法签发极速通道凭据' })
			}
			return
		}
		if (message.type === 'native-agent-ticket-response') {
			const pending = this.pendingNativeTickets.get(message.requestId)
			if (!pending) return
			clearTimeout(pending.timer)
			this.pendingNativeTickets.delete(message.requestId)
			if (message.ticket) pending.resolve(message.ticket)
			else pending.reject(new Error(message.error || '加速电脑没有返回有效凭据'))
			return
		}
		if (message.type === 'chat-message') {
			if (!message.id) return
			this.emit({ type: 'message-upsert', message: { id: message.id, direction: 'in', kind: 'text', text: message.text, attachments: [], status: 'received', createdAt: message.createdAt, peerId: message.peerId } })
			this.sendChatReceipt([message.id])
			return
		}
		if (message.type === 'chat-receipt') {
			if (Array.isArray(message.messageIds)) this.markTextDelivered(message.messageIds.filter(id => typeof id === 'string' && id))
			return
		}
		if (message.type === 'chat-history') {
			if (!Array.isArray(message.messages)) return
			this.emit({ type: 'history-merge', messages: message.messages.map(historyMessageFromRemote) })
			this.markTextDelivered(message.messages.filter(item => item.kind === 'text' && item.direction === 'in').map(item => item.id))
			this.sendChatReceipt(message.messages.filter(item => item.kind === 'text' && item.direction === 'out').map(item => item.id))
			return
		}
		if (message.type === 'attachment-offer') return void (await this.handleOffer(message))
		if (message.type === 'native-transfer-request') return void (await this.native.handleRequest(message))
		if (message.type === 'native-transfer-ready') return void (await this.native.handleReady(message))
		if (message.type === 'attachment-accept') {
			const entry = this.prepared.get(message.id)
			if (!entry || message.messageId !== entry.file.messageId) return
			entry.accepted = message
			entry.ranges = message.receivedRanges.map(range => [...range] as [number, number])
			entry.acked = message.receivedBytes
			this.resetTransferSample(message.id, entry.acked)
			this.sender.upsert(entry.file, entry.acked, entry.ranges)
			return
		}
		if (message.type === 'attachment-progress') {
			const entry = this.prepared.get(message.id)
			if (entry && message.messageId === entry.file.messageId) {
				entry.acked = Math.max(entry.acked, message.received)
				this.sender.updateAck(message.id, entry.acked)
				this.emit({ type: 'attachment-patch', patch: this.transferPatch(message.id, message.messageId, 'sending', entry.acked, entry.file.size) })
			}
			return
		}
		if (message.type === 'attachment-complete') return void (await this.finishIncoming(message.id, message.messageId, message.sent, message.chunkCount))
		if (message.type === 'attachment-received') {
			if (await this.native.handleReceived(message.id, message.messageId, message.received, message.expected)) return
			return this.completeOutgoing(message)
		}
		if (message.type === 'attachment-cancel') {
			if (this.native.handleCancel(message.id, message.reason || '已取消')) return
			this.failAttachment(message.id, message.messageId, message.reason || '已取消', false)
			return
		}
		if (message.type === 'resume-query') {
			const transport = this.transport
			const epoch = this.transportEpoch
			if (!transport || message.transportGeneration !== transport.generation) return
			await this.chunkWriteQueue
			const attachments = await Promise.all(message.ids.map(async id => {
				const cached = this.receivedCache.get(id)
				if (cached) {
					return { id, messageId: cached.messageId, state: 'complete' as const, receivedRanges: cached.chunkCount ? [[0, cached.chunkCount - 1] as [number, number]] : [], receivedBytes: cached.size, receivedChunks: cached.chunkCount, storage: cached.storage }
				}
				const current = this.incoming.get(id)
				if (!current) return { id, state: 'unknown' as const, receivedRanges: [], receivedBytes: 0, receivedChunks: 0 }
				if (this.finalizingIncoming.has(id)) {
					const complete = current.received === current.offer.attachment.size && current.chunkCount === current.offer.attachment.chunkCount
					return complete
						? { id, messageId: current.offer.messageId, state: 'receiving' as const, receivedRanges: current.chunkCount ? [[0, current.chunkCount - 1] as [number, number]] : [], receivedBytes: current.received, receivedChunks: current.chunkCount, storage: current.engine.kind }
						: { id, state: 'unknown' as const, receivedRanges: [], receivedBytes: 0, receivedChunks: 0 }
				}
				const snapshot = await this.checkpointIncoming(current).catch(() => null)
				return snapshot
					? { id, messageId: current.offer.messageId, state: 'receiving' as const, ...snapshot, storage: current.engine.kind }
					: { id, state: 'unknown' as const, receivedRanges: [], receivedBytes: 0, receivedChunks: 0 }
			}))
			if (epoch !== this.transportEpoch || this.transport !== transport) return
			this.sendControl({ ...this.controlBase('resume-state'), resumeId: message.resumeId, transportGeneration: message.transportGeneration, transportEpoch: message.transportEpoch, attachments })
			return
		}
		if (message.type === 'resume-state') {
			const sync = this.resumeSync
			const transport = this.transport
			if (!sync || !transport || message.resumeId !== sync.id || message.transportEpoch !== sync.epoch || message.transportGeneration !== sync.generation || transport.generation !== sync.generation) return
			const snapshots = new Map(message.attachments.map(item => [item.id, item]))
			for (const id of sync.ids) {
				const entry = this.prepared.get(id)
				if (!entry) continue
				const item = snapshots.get(id)
				if (item?.state === 'complete') {
					this.completeOutgoing({ ...this.controlBase('attachment-received'), id, messageId: item.messageId || entry.file.messageId, received: entry.file.size, expected: entry.file.size, chunkCount: entry.file.chunkCount, storage: item.storage || entry.file.suggestedStorage })
					continue
				}
				if (item?.state === 'receiving' && item.messageId === entry.file.messageId && item.storage) {
					entry.ranges = item.receivedRanges.map(range => [...range] as [number, number])
					entry.acked = item.receivedBytes
					if (entry.accepted) entry.accepted = { ...entry.accepted, storage: item.storage, receivedRanges: entry.ranges, receivedBytes: entry.acked }
					this.resetTransferSample(id, entry.acked)
					this.emit({ type: 'attachment-patch', patch: { ...this.transferPatch(id, entry.file.messageId, 'queued', entry.acked, entry.file.size), phase: undefined } })
					this.sender.sync(entry.file, entry.acked, entry.ranges, Boolean(entry.accepted))
					continue
				}
				this.sender.remove(id)
				entry.accepted = undefined
				entry.ranges = []
				entry.acked = 0
			}
			this.clearResumeSync()
			this.flushOffersAndQueue()
			return
		}
	}

	private confirmReceived(id: string, messageIdValue: string, size: number, chunkCount: number, storage: TransferFileMeta['storage']) {
		this.sendControl({ ...this.controlBase('attachment-received'), id, messageId: messageIdValue, received: size, expected: size, chunkCount, storage })
	}

	private failAttachment(id: string, messageIdValue: string | undefined, reason: string, notifyPeer = true) {
		this.sender.remove(id)
		this.emit({ type: 'attachment-patch', patch: { id, messageId: messageIdValue, status: 'failed', error: reason, phase: undefined } })
		this.emit({ type: 'file-record-patch', id, patch: { status: 'failed' } })
		if (notifyPeer) this.sendControl({ ...this.controlBase('attachment-cancel'), id, messageId: messageIdValue, reason })
		this.prepared.delete(id)
		this.progressAck.delete(id)
		this.transferSamples.delete(id)
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
