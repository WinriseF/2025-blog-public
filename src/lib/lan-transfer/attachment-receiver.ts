import { assertCanReceiveFile } from './capability'
import { chooseReceiveStorage, attachmentFromOffer, fileRecord, isInlineMediaKind, isUserCancel, messageBase, receiveStorageCandidates, transferMeta } from './connection-runtime-helpers'
import type { RuntimeContext, RuntimeControlBase, RuntimeEmit } from './connection-runtime-types'
import { IncomingAttachmentWriter, type IncomingWriterSnapshot } from './incoming-attachment-writer'
import { createStorageEngine } from './storage/storage-manager'
import type { FinalizedFile, LanStorageEngine, TransferFileMeta } from './storage/types'
import { LAN_LIMITS, type LanAttachmentOffer, type LanCapability, type LanControlMessage, type LanResumeState } from './types'

type IncomingAttachment = { offer: LanAttachmentOffer; writer: IncomingAttachmentWriter; engine: LanStorageEngine; meta: TransferFileMeta; finalizeTask?: Promise<FinalizedFile> }
type CachedReceivedFile = { engine: LanStorageEngine; fileId: string; messageId: string; size: number; chunkCount: number; storage: TransferFileMeta['storage']; url?: string }
type ProgressState = { lastSentAt: number; timer?: ReturnType<typeof setTimeout>; snapshot: IncomingWriterSnapshot }

type ReceiverDependencies = {
	getContext: () => RuntimeContext | null
	getLocalCapability: (fileSize?: number) => Promise<LanCapability>
	getTransportEpoch: () => number
	controlBase: RuntimeControlBase
	sendControl: (message: LanControlMessage) => boolean
	emit: RuntimeEmit
	setStatus: (message: string) => void
	onActivityChange: () => void
}

export class LanAttachmentReceiver {
	private incoming = new Map<string, IncomingAttachment>()
	private pendingOffers = new Map<string, LanAttachmentOffer>()
	private receivedCache = new Map<string, CachedReceivedFile>()
	private cancelled = new Map<string, string>()
	private progress = new Map<string, ProgressState>()
	private destroyed = false

	constructor(private readonly deps: ReceiverDependencies) {}

	async accept(id: string, autoInlineMedia = false) {
		const offer = this.pendingOffers.get(id)
		const context = this.deps.getContext()
		if (!offer || !context || this.destroyed) return
		let capability = context.localCapability || null
		try {
			capability ||= await this.deps.getLocalCapability(offer.attachment.size)
			if (autoInlineMedia && offer.attachment.size > LAN_LIMITS.memoryMaxBytes && !capability.storage.opfs && !capability.storage.indexedDB) throw new Error('当前设备不能自动缓存该媒体')
			assertCanReceiveFile(offer.attachment.size, capability)
			this.patchProgress(offer, 'receiving', { committedBytes: 0, diskCommitBps: 0 })
			const prepared = await this.prepareIncoming(offer, capability, !autoInlineMedia)
			if (this.destroyed) return void prepared.engine.cleanup(prepared.meta.id).catch(() => {})
			let current!: IncomingAttachment
			const writer = new IncomingAttachmentWriter(prepared.engine, prepared.meta, prepared.manifest, this.maxWindowBytes(context, capability), {
				onUpdate: (snapshot, force) => {
					if (this.incoming.get(id) === current) this.reportProgress(current, snapshot, force)
				},
				onFailure: reason => {
					if (this.incoming.get(id) === current) this.fail(id, offer.messageId, reason)
				},
			})
			current = { offer, writer, engine: prepared.engine, meta: prepared.meta }
			this.incoming.set(id, current)
			this.pendingOffers.delete(id)
			this.deps.onActivityChange()
			const snapshot = writer.snapshot()
			this.patchProgress(offer, 'receiving', snapshot, prepared.engine.kind)
			this.deps.sendControl({ ...this.deps.controlBase('attachment-accept'), id, messageId: offer.messageId, storage: prepared.engine.kind, receivedRanges: snapshot.committedRanges, receivedBytes: snapshot.committedBytes, receiveWindowBytes: snapshot.receiveWindowBytes, queuedBytes: snapshot.queuedBytes, pausedReason: snapshot.pausedReason })
			this.deps.setStatus(`正在接收 ${offer.attachment.name}`)
		} catch (error) {
			const reason = isUserCancel(error) ? '已取消下载' : error instanceof Error ? error.message : '当前设备不能接收该文件'
			const status = isUserCancel(error) ? 'cancelled' : 'failed'
			this.pendingOffers.delete(id)
			if (status === 'cancelled') this.cancelled.set(id, reason)
			this.deps.emit({ type: 'attachment-patch', patch: { id, messageId: offer.messageId, status, error: reason } })
			this.deps.emit({ type: 'file-record-patch', id, patch: { status } })
			this.deps.sendControl({ ...this.deps.controlBase('attachment-cancel'), id, messageId: offer.messageId, reason })
			this.deps.setStatus(reason)
		}
	}

	async handleOffer(message: LanAttachmentOffer, transportEpoch: number) {
		const context = this.deps.getContext()
		if (!context || this.destroyed || transportEpoch !== this.deps.getTransportEpoch()) return
		let capability = context.localCapability || null
		capability ||= await this.deps.getLocalCapability(message.attachment.size)
		if (this.destroyed || transportEpoch !== this.deps.getTransportEpoch()) return
		try {
			const cancelledReason = this.cancelled.get(message.attachment.id)
			if (cancelledReason) return void this.deps.sendControl({ ...this.deps.controlBase('attachment-cancel'), id: message.attachment.id, messageId: message.messageId, reason: cancelledReason })
			const cached = this.receivedCache.get(message.attachment.id)
			if (cached && cached.size === message.attachment.size && cached.chunkCount === message.attachment.chunkCount) {
				const attachment = { ...attachmentFromOffer(message, cached.storage, 1), status: 'complete' as const, url: cached.url, previewUrl: message.attachment.kind === 'image' ? cached.url : undefined }
				this.deps.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
				this.deps.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
				return void this.confirmReceived(message.attachment.id, message.messageId, cached.size, cached.chunkCount, cached.storage)
			}
			assertCanReceiveFile(message.attachment.size, capability)
			const current = this.incoming.get(message.attachment.id)
			if (current) return void this.sendAccept(current)
			this.pendingOffers.set(message.attachment.id, message)
			const inline = isInlineMediaKind(message.attachment.kind)
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability, !inline)
			const attachment = { ...attachmentFromOffer(message, storage), status: 'offered' as const }
			this.deps.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
			this.deps.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
			if (inline) {
				this.deps.setStatus(`正在缓存 ${message.attachment.kind === 'image' ? '图片' : '语音'}`)
				void this.accept(message.attachment.id, true)
			} else this.deps.setStatus(`${message.attachment.name} 等待下载`)
		} catch (error) {
			const storage = chooseReceiveStorage(message.attachment.size, message.attachment.suggestedStorage, capability)
			const reason = error instanceof Error ? error.message : '当前设备不能接收该文件'
			const attachment = { ...attachmentFromOffer(message, storage), status: 'failed' as const, error: reason }
			this.deps.emit({ type: 'attachment-upsert', message: messageBase(message.messageId, 'in', message.createdAt, message.peerId), attachment })
			this.deps.emit({ type: 'file-record-upsert', record: fileRecord(message.messageId, attachment, context.remotePeerName) })
			this.deps.sendControl({ ...this.deps.controlBase('attachment-cancel'), id: message.attachment.id, messageId: message.messageId, reason })
		}
	}

	handleChunk(id: string, chunkIndex: number, bytes: Uint8Array) {
		const current = this.incoming.get(id)
		if (!current) return
		if (!current.writer.enqueue(chunkIndex, bytes)) this.reportProgress(current, current.writer.snapshot(), true)
	}

	async finish(id: string, messageId: string, sent: number | undefined, chunkCount: number | undefined, transportEpoch: number) {
		const current = this.incoming.get(id)
		if (!current) return
		const manifest = await current.writer.waitForComplete()
		if (this.destroyed || this.incoming.get(id) !== current || transportEpoch !== this.deps.getTransportEpoch()) return
		if (!manifest || sent !== undefined && sent !== current.meta.size || chunkCount !== undefined && chunkCount !== manifest.receivedChunks || manifest.receivedBytes !== current.meta.size || manifest.receivedChunks !== current.meta.chunkCount) {
			return this.fail(id, messageId, '接收不完整，请重新发送')
		}
		try {
			const finalized = await (current.finalizeTask ||= current.writer.finalize())
			if (transportEpoch !== this.deps.getTransportEpoch()) return
			if (this.destroyed || this.incoming.get(id) !== current) {
				if (finalized.url) URL.revokeObjectURL(finalized.url)
				return void current.engine.cleanup(id).catch(() => {})
			}
			const inline = isInlineMediaKind(current.offer.attachment.kind)
			this.deps.emit({ type: 'attachment-patch', patch: { id, messageId, status: 'complete', progress: 1, transferredBytes: current.meta.size, speedBps: undefined, etaSeconds: undefined, url: finalized.url, previewUrl: current.offer.attachment.kind === 'image' ? finalized.url : undefined } })
			this.deps.emit({ type: 'file-record-patch', id, patch: { status: 'complete', url: finalized.url } })
			this.receivedCache.set(id, { engine: current.engine, fileId: id, messageId, size: current.meta.size, chunkCount: manifest.receivedChunks, storage: current.engine.kind, url: finalized.url })
			this.clearProgress(id)
			this.confirmReceived(id, messageId, current.meta.size, manifest.receivedChunks, current.engine.kind)
			this.incoming.delete(id)
			this.deps.onActivityChange()
			if (finalized.url && !inline) this.deps.emit({ type: 'download-ready', name: current.offer.attachment.name, url: finalized.url })
			this.deps.setStatus(inline ? '媒体已缓存' : finalized.directSave ? '接收完成，文件已保存' : '接收完成，可在文件页查看')
		} catch (error) {
			this.fail(id, messageId, error instanceof Error ? error.message : '文件保存失败')
		}
	}

	resumeState(ids: string[]): LanResumeState['attachments'] {
		return ids.map(id => {
			const cached = this.receivedCache.get(id)
			if (cached) return { id, messageId: cached.messageId, state: 'complete' as const, receivedRanges: cached.chunkCount ? [[0, cached.chunkCount - 1] as [number, number]] : [], receivedBytes: cached.size, receivedChunks: cached.chunkCount, storage: cached.storage, receiveWindowBytes: 0, queuedBytes: 0 }
			const current = this.incoming.get(id)
			if (!current) return { id, state: 'unknown' as const, receivedRanges: [], receivedBytes: 0, receivedChunks: 0, receiveWindowBytes: 0, queuedBytes: 0 }
			const snapshot = current.writer.snapshot()
			return { id, messageId: current.offer.messageId, state: 'receiving' as const, receivedRanges: snapshot.committedRanges, receivedBytes: snapshot.committedBytes, receivedChunks: snapshot.committedChunks, storage: current.engine.kind, receiveWindowBytes: snapshot.receiveWindowBytes, queuedBytes: snapshot.queuedBytes, pausedReason: snapshot.pausedReason }
		})
	}

	discardPending() {
		this.incoming.forEach(item => item.writer.discardPending())
	}

	cancel(id: string, messageId: string | undefined, reason: string) {
		if (!this.incoming.has(id) && !this.pendingOffers.has(id)) return
		this.fail(id, messageId, reason, false)
	}

	isActive() {
		return this.incoming.size > 0
	}

	diagnostics() {
		const snapshots = Array.from(this.incoming.values(), item => item.writer.snapshot())
		return {
			active: snapshots.length > 0,
			queuedBytes: snapshots.reduce((sum, item) => sum + item.queuedBytes, 0),
			receiveWindowBytes: snapshots.length ? Math.min(...snapshots.map(item => item.receiveWindowBytes)) : 0,
			diskCommitBps: snapshots.reduce((sum, item) => sum + item.diskCommitBps, 0),
			pausedReason: snapshots.find(item => item.pausedReason)?.pausedReason,
		}
	}

	destroy() {
		this.destroyed = true
		this.progress.forEach(item => item.timer && clearTimeout(item.timer))
		this.progress.clear()
		this.incoming.forEach(item => void item.writer.destroy())
		this.incoming.clear()
		this.receivedCache.forEach(file => {
			if (file.url) URL.revokeObjectURL(file.url)
			void file.engine.cleanup(file.fileId).catch(() => {})
		})
		this.receivedCache.clear()
		this.pendingOffers.clear()
		this.cancelled.clear()
	}

	private async prepareIncoming(message: LanAttachmentOffer, capability: LanCapability | null, allowDirectFile: boolean) {
		const failures: string[] = []
		for (const storage of receiveStorageCandidates(message.attachment.size, message.attachment.suggestedStorage, capability, allowDirectFile)) {
			const engine = createStorageEngine(storage)
			const meta = transferMeta(message, storage)
			try {
				if (storage !== 'file') await engine.cleanup(meta.id).catch(() => {})
				await engine.prepare(meta)
				const manifest = await engine.getManifest(meta.id)
				if (!manifest) throw new Error('无法读取接收进度')
				return { engine, meta, manifest }
			} catch (error) {
				await engine.cleanup(meta.id).catch(() => {})
				if (storage === 'file' && isUserCancel(error)) throw error
				failures.push(error instanceof Error ? error.message : '无法准备保存文件')
			}
		}
		throw new Error(failures[0] || '当前设备不能接收该文件')
	}

	private maxWindowBytes(context: RuntimeContext, capability: LanCapability) {
		const mobile = context.session.localPeer.deviceType !== 'desktop' || capability.platform === 'android' || capability.platform === 'ios'
		return mobile ? LAN_LIMITS.mobileMaxSenderAheadBytes : LAN_LIMITS.maxSenderAheadBytes
	}

	private sendAccept(current: IncomingAttachment) {
		const snapshot = current.writer.snapshot()
		this.deps.sendControl({ ...this.deps.controlBase('attachment-accept'), id: current.meta.id, messageId: current.offer.messageId, storage: current.engine.kind, receivedRanges: snapshot.committedRanges, receivedBytes: snapshot.committedBytes, receiveWindowBytes: snapshot.receiveWindowBytes, queuedBytes: snapshot.queuedBytes, pausedReason: snapshot.pausedReason })
	}

	private reportProgress(current: IncomingAttachment, snapshot: IncomingWriterSnapshot, force: boolean) {
		const id = current.meta.id
		const now = Date.now()
		const state = this.progress.get(id) || { lastSentAt: 0, snapshot }
		state.snapshot = snapshot
		this.progress.set(id, state)
		const dueIn = LAN_LIMITS.progressAckIntervalMs - (now - state.lastSentAt)
		if (dueIn <= 0) return this.sendProgress(current, state)
		if (state.timer) return
		state.timer = setTimeout(() => {
			state.timer = undefined
			if (this.incoming.get(id) === current) this.sendProgress(current, state)
		}, force ? Math.max(0, dueIn) : LAN_LIMITS.progressAckIntervalMs)
	}

	private sendProgress(current: IncomingAttachment, state: ProgressState) {
		state.lastSentAt = Date.now()
		const snapshot = state.snapshot
		this.patchProgress(current.offer, 'receiving', snapshot, current.engine.kind)
		this.deps.sendControl({ ...this.deps.controlBase('attachment-progress'), id: current.meta.id, messageId: current.offer.messageId, committedBytes: snapshot.committedBytes, committedRanges: snapshot.committedRanges, chunkCount: snapshot.committedChunks, storage: current.engine.kind, receiveWindowBytes: snapshot.receiveWindowBytes, queuedBytes: snapshot.queuedBytes, pausedReason: snapshot.pausedReason })
		if (snapshot.pausedReason) this.deps.setStatus(snapshot.pausedReason)
	}

	private patchProgress(offer: LanAttachmentOffer, status: 'receiving', snapshot: Pick<IncomingWriterSnapshot, 'committedBytes' | 'diskCommitBps'>, storage?: TransferFileMeta['storage']) {
		const total = offer.attachment.size
		const speed = snapshot.diskCommitBps || undefined
		this.deps.emit({ type: 'attachment-patch', patch: { id: offer.attachment.id, messageId: offer.messageId, status, storage, progress: total ? snapshot.committedBytes / total : 1, transferredBytes: snapshot.committedBytes, speedBps: speed, etaSeconds: speed && snapshot.committedBytes < total ? (total - snapshot.committedBytes) / speed : undefined } })
		this.deps.emit({ type: 'file-record-patch', id: offer.attachment.id, patch: { status, ...(storage ? { storage } : {}) } })
	}

	private confirmReceived(id: string, messageId: string, size: number, chunkCount: number, storage: TransferFileMeta['storage']) {
		this.deps.sendControl({ ...this.deps.controlBase('attachment-received'), id, messageId, received: size, expected: size, chunkCount, storage })
	}

	private fail(id: string, messageId: string | undefined, reason: string, notifyPeer = true) {
		this.deps.emit({ type: 'attachment-patch', patch: { id, messageId, status: 'failed', error: reason } })
		this.deps.emit({ type: 'file-record-patch', id, patch: { status: 'failed' } })
		if (notifyPeer) this.deps.sendControl({ ...this.deps.controlBase('attachment-cancel'), id, messageId, reason })
		const current = this.incoming.get(id)
		this.incoming.delete(id)
		if (current) void current.writer.destroy()
		this.clearProgress(id)
		this.deps.onActivityChange()
		this.deps.setStatus(reason)
	}

	private clearProgress(id: string) {
		const state = this.progress.get(id)
		if (state?.timer) clearTimeout(state.timer)
		this.progress.delete(id)
	}
}
