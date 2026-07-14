import { selectStorageForFile } from './capability'
import { attachmentFromPrepared, fileRecord } from './connection-runtime-helpers'
import type { AttachmentPatch, RuntimeContext, RuntimeControlBase, RuntimeEmit, SendFilesOptions } from './connection-runtime-types'
import { imagePreviewUrl, messageId, prepareLanAttachment, sendPreparedAttachment } from './file-transfer'
import type { LanConnectionTransport } from './transport-types'
import { type LanAttachmentAccept, type LanAttachmentProgress, type LanAttachmentReceived, type LanControlMessage, type LanResumeState, type PreparedLanAttachment } from './types'

type PreparedEntry = {
	file: PreparedLanAttachment
	createdAt: number
	committed: number
	ranges: Array<[number, number]>
	receiveWindowBytes: number
	queuedBytes: number
	pausedReason?: string
	offered: boolean
	accepted?: LanAttachmentAccept
}
type ResumeSync = { id: string; epoch: number; generation: number; ids: Set<string>; attempt: number; timer?: ReturnType<typeof setTimeout> }
type TransferSample = { bytes: number; ts: number; speedBps: number }

type SenderDependencies = {
	getContext: () => RuntimeContext | null
	getTransport: () => LanConnectionTransport | null
	getTransportEpoch: () => number
	controlBase: RuntimeControlBase
	sendControl: (message: LanControlMessage) => boolean
	emit: RuntimeEmit
	setStatus: (message: string) => void
	onActivityChange: () => void
}

const resumeRetryDelays = [1000, 2000, 4000]

export class LanAttachmentSender {
	private prepared = new Map<string, PreparedEntry>()
	private queue: string[] = []
	private activeSending: string | null = null
	private activeController: AbortController | null = null
	private activeTask: Promise<void> | null = null
	private sendBarrier: Promise<void> = Promise.resolve()
	private resumePending = false
	private resumeSync: ResumeSync | null = null
	private samples = new Map<string, TransferSample>()
	private objectUrls: string[] = []
	private destroyed = false

	constructor(private readonly deps: SenderDependencies) {}

	async sendFiles(files: File[], options: SendFilesOptions = {}) {
		const context = this.deps.getContext()
		const transport = this.deps.getTransport()
		if (!files.length) return
		if (!context || !transport?.isOpen()) return this.deps.setStatus('请先连接设备')
		const remote = context.remoteCapability || null
		const createdAt = Date.now()
		const id = messageId()
		try {
			const chunkSize = await transport.negotiateChunkSize(remote?.limits.recommendedChunkSize)
			if (this.deps.getTransport() !== transport || !transport.isOpen()) throw new Error('连接已断开，请重新发送')
			const prepared = files.map(file => prepareLanAttachment(file, { messageId: id, kind: options.kind, chunkSize, suggestedStorage: selectStorageForFile(file.size, remote), maxBytes: remote?.limits.maxExperimentalFileSize, durationMs: options.durationMs }))
			const attachments = await Promise.all(prepared.map(async file => {
				const previewUrl = file.kind === 'image' ? await imagePreviewUrl(file.file) : ''
				const localUrl = previewUrl || URL.createObjectURL(file.file)
				this.objectUrls.push(localUrl)
				return { ...attachmentFromPrepared(file, file.suggestedStorage, previewUrl), url: localUrl }
			}))
			if (this.destroyed) return void attachments.forEach(attachment => attachment.url && URL.revokeObjectURL(attachment.url))
			this.deps.emit({ type: 'message-upsert', message: { id, direction: 'out', kind: 'attachments', attachments, status: 'queued', createdAt, peerId: context.session.instanceId } })
			for (const attachment of attachments) this.deps.emit({ type: 'file-record-upsert', record: fileRecord(id, attachment, context.remotePeerName) })
			for (const file of prepared) this.prepared.set(file.id, { file, createdAt, committed: 0, ranges: [], receiveWindowBytes: 0, queuedBytes: 0, offered: false })
			this.flushOffersAndQueue()
		} catch (error) {
			this.deps.setStatus(error instanceof Error ? error.message : '发送失败')
		}
	}

	prepareForResume() {
		this.resumePending = true
		const activeId = this.activeSending
		if (activeId && this.prepared.get(activeId)?.accepted && !this.queue.includes(activeId)) this.queue.unshift(activeId)
		this.abortActive()
		this.activeSending = null
		this.clearResumeSync()
		this.prepared.forEach(entry => { entry.offered = false })
		this.deps.onActivityChange()
	}

	startResume() {
		const transport = this.deps.getTransport()
		if (!transport?.isOpen()) return
		const ids = new Set(this.prepared.keys())
		if (!ids.size) {
			this.resumePending = false
			return this.flushOffersAndQueue()
		}
		const sync: ResumeSync = { id: messageId(), epoch: this.deps.getTransportEpoch(), generation: transport.generation, ids, attempt: 0 }
		this.resumeSync = sync
		this.resumePending = false
		this.deps.setStatus('正在同步文件断点')
		void this.sendBarrier.then(() => this.sendResumeQuery(sync))
	}

	handleAccept(message: LanAttachmentAccept) {
		const entry = this.prepared.get(message.id)
		if (!entry || message.messageId !== entry.file.messageId) return
		entry.accepted = message
		this.applyFlow(entry, message.receivedBytes, message.receivedRanges, message.receiveWindowBytes, message.queuedBytes, message.pausedReason)
		this.resetSample(message.id, entry.committed)
		if (!this.queue.includes(message.id) && this.activeSending !== message.id) this.queue.push(message.id)
		this.pumpQueue()
	}

	handleProgress(message: LanAttachmentProgress) {
		const entry = this.prepared.get(message.id)
		if (!entry || message.messageId !== entry.file.messageId) return
		this.applyFlow(entry, message.committedBytes, message.committedRanges, message.receiveWindowBytes, message.queuedBytes, message.pausedReason)
		this.deps.emit({ type: 'attachment-patch', patch: this.transferPatch(message.id, message.messageId, 'sending', entry.committed, entry.file.size) })
		if (message.pausedReason) this.deps.setStatus(message.pausedReason)
	}

	handleReceived(message: LanAttachmentReceived) {
		const entry = this.prepared.get(message.id)
		if (!entry || message.messageId !== entry.file.messageId) return
		if (this.activeSending === message.id) this.abortActive()
		this.prepared.delete(message.id)
		this.queue = this.queue.filter(id => id !== message.id)
		this.activeSending = null
		this.deps.emit({ type: 'attachment-patch', patch: { id: message.id, messageId: message.messageId, status: 'complete', progress: 1, transferredBytes: entry.file.size, speedBps: undefined, etaSeconds: undefined } })
		this.deps.emit({ type: 'file-record-patch', id: message.id, patch: { status: 'complete' } })
		this.samples.delete(message.id)
		this.deps.setStatus('对方已收到')
		this.deps.onActivityChange()
		this.pumpQueue()
	}

	handleResumeState(message: LanResumeState) {
		const sync = this.resumeSync
		const transport = this.deps.getTransport()
		if (!sync || !transport || message.resumeId !== sync.id || message.transportEpoch !== sync.epoch || message.transportGeneration !== sync.generation || transport.generation !== sync.generation) return
		const snapshots = new Map(message.attachments.map(item => [item.id, item]))
		for (const id of sync.ids) {
			const entry = this.prepared.get(id)
			if (!entry) continue
			const item = snapshots.get(id)
			if (item?.state === 'complete') {
				this.handleReceived({ ...this.deps.controlBase('attachment-received'), id, messageId: item.messageId || entry.file.messageId, received: entry.file.size, expected: entry.file.size, chunkCount: entry.file.chunkCount, storage: item.storage || entry.file.suggestedStorage })
				continue
			}
			if (item?.state === 'receiving' && item.messageId === entry.file.messageId && item.storage) {
				this.applyFlow(entry, item.receivedBytes, item.receivedRanges, item.receiveWindowBytes, item.queuedBytes, item.pausedReason)
				if (entry.accepted) entry.accepted = { ...entry.accepted, storage: item.storage, receivedRanges: entry.ranges, receivedBytes: entry.committed, receiveWindowBytes: entry.receiveWindowBytes, queuedBytes: entry.queuedBytes, pausedReason: entry.pausedReason }
				this.resetSample(id, entry.committed)
				this.deps.emit({ type: 'attachment-patch', patch: this.transferPatch(id, entry.file.messageId, 'queued', entry.committed, entry.file.size) })
				if (entry.accepted && !this.queue.includes(id)) this.queue.push(id)
				continue
			}
			entry.accepted = undefined
			entry.ranges = []
			entry.committed = 0
			entry.receiveWindowBytes = 0
		}
		this.clearResumeSync()
		this.flushOffersAndQueue()
	}

	cancel(id: string, messageIdValue: string | undefined, reason: string) {
		if (!this.prepared.has(id)) return
		this.fail(id, messageIdValue, reason, false)
		this.pumpQueue()
	}

	detach() {
		this.prepareForResume()
	}

	isActive() {
		return Boolean(this.activeSending)
	}

	diagnostics() {
		const entry = this.activeSending ? this.prepared.get(this.activeSending) : undefined
		return { active: Boolean(entry), queuedBytes: entry?.queuedBytes || 0, receiveWindowBytes: entry?.receiveWindowBytes || 0, pausedReason: entry?.pausedReason }
	}

	destroy() {
		this.destroyed = true
		this.abortActive()
		this.clearResumeSync()
		this.prepared.clear()
		this.queue = []
		this.samples.clear()
		this.objectUrls.forEach(url => URL.revokeObjectURL(url))
		this.objectUrls = []
	}

	private flushOffersAndQueue() {
		if (!this.deps.getTransport()?.isOpen() || this.resumePending || this.resumeSync) return
		this.prepared.forEach(entry => {
			if (entry.offered) return
			const file = entry.file
			const offered = this.deps.sendControl({ ...this.deps.controlBase('attachment-offer', entry.createdAt), messageId: file.messageId, attachment: { id: file.id, kind: file.kind, name: file.name, mime: file.mime, size: file.size, lastModified: file.lastModified, durationMs: file.durationMs, chunkSize: file.chunkSize, chunkCount: file.chunkCount, suggestedStorage: file.suggestedStorage } })
			if (!offered) return
			entry.offered = true
			this.deps.emit({ type: 'attachment-patch', patch: { id: file.id, messageId: file.messageId, status: 'offered' } })
			this.deps.setStatus(`等待对方下载 ${file.name}`)
		})
		this.pumpQueue()
	}

	private pumpQueue() {
		if (!this.deps.getTransport()?.isOpen() || this.resumePending || this.resumeSync || this.activeSending || this.activeTask) return
		const nextId = this.queue.find(id => this.prepared.get(id)?.accepted)
		const entry = nextId ? this.prepared.get(nextId) : undefined
		const accepted = entry?.accepted
		if (!nextId || !entry || !accepted) return
		this.queue = this.queue.filter(id => id !== nextId)
		this.activeSending = nextId
		const transport = this.deps.getTransport()
		const epoch = this.deps.getTransportEpoch()
		if (!transport) return
		const controller = new AbortController()
		this.activeController = controller
		this.resetSample(nextId, entry.committed)
		this.deps.emit({ type: 'attachment-patch', patch: this.transferPatch(nextId, entry.file.messageId, 'sending', entry.committed, entry.file.size) })
		this.deps.setStatus(`正在发送 ${entry.file.name}`)
		this.deps.onActivityChange()
		let task!: Promise<void>
		task = sendPreparedAttachment(transport, entry.file, () => {}, {
			mobile: this.isLocalMobile(),
			getFlowState: () => ({ committedBytes: entry.committed, receiveWindowBytes: entry.receiveWindowBytes, pausedReason: entry.pausedReason }),
			receivedRanges: entry.ranges.map(range => [...range] as [number, number]),
			signal: controller.signal,
			completeMessage: { ...this.deps.controlBase('attachment-complete'), id: entry.file.id, messageId: entry.file.messageId, sent: entry.file.size, chunkCount: entry.file.chunkCount },
		}).then(() => {
			if (epoch !== this.deps.getTransportEpoch() || this.deps.getTransport() !== transport) return
			this.deps.setStatus(`已发送 ${entry.file.name}，等待对方写入完成`)
		}).catch(error => {
			if (controller.signal.aborted || epoch !== this.deps.getTransportEpoch() || this.deps.getTransport() !== transport) return
			this.activeSending = null
			if (!this.deps.getTransport()?.isOpen()) {
				if (entry.accepted && !this.queue.includes(nextId)) this.queue.unshift(nextId)
				this.deps.emit({ type: 'attachment-patch', patch: { id: nextId, messageId: entry.file.messageId, status: 'queued' } })
				return void this.deps.setStatus('连接断了，恢复后会继续')
			}
			this.fail(nextId, entry.file.messageId, error instanceof Error ? error.message : '发送失败')
		}).finally(() => {
			if (this.activeTask === task) this.activeTask = null
			if (this.activeController === controller) this.activeController = null
			this.deps.onActivityChange()
			this.pumpQueue()
		})
		this.activeTask = task
	}

	private sendResumeQuery(sync: ResumeSync) {
		if (this.resumeSync !== sync) return
		const transport = this.deps.getTransport()
		if (!transport || sync.epoch !== this.deps.getTransportEpoch() || sync.generation !== transport.generation) return this.resumeFailed(sync)
		this.deps.sendControl({ ...this.deps.controlBase('resume-query'), resumeId: sync.id, transportGeneration: sync.generation, transportEpoch: sync.epoch, ids: Array.from(sync.ids) })
		if (sync.attempt >= resumeRetryDelays.length) {
			sync.timer = setTimeout(() => this.resumeFailed(sync), resumeRetryDelays[resumeRetryDelays.length - 1])
			return
		}
		const delay = resumeRetryDelays[sync.attempt]
		sync.attempt += 1
		sync.timer = setTimeout(() => this.sendResumeQuery(sync), delay)
	}

	private resumeFailed(sync: ResumeSync) {
		if (this.resumeSync !== sync) return
		this.clearResumeSync()
		for (const id of sync.ids) {
			const entry = this.prepared.get(id)
			if (!entry) continue
			entry.offered = false
			entry.accepted = undefined
			entry.ranges = []
			entry.committed = 0
			entry.receiveWindowBytes = 0
			this.queue = this.queue.filter(item => item !== id)
		}
		this.deps.setStatus('断点同步失败，已重新发送文件请求')
		this.flushOffersAndQueue()
	}

	private applyFlow(entry: PreparedEntry, committed: number, ranges: Array<[number, number]>, windowBytes: number, queuedBytes: number, pausedReason?: string) {
		entry.committed = Math.max(0, Math.min(entry.file.size, committed))
		entry.ranges = ranges.map(range => [...range] as [number, number])
		entry.receiveWindowBytes = Math.max(0, windowBytes)
		entry.queuedBytes = Math.max(0, queuedBytes)
		entry.pausedReason = pausedReason
	}

	private transferPatch(id: string, messageIdValue: string, status: AttachmentPatch['status'], bytes: number, total: number): AttachmentPatch {
		const now = Date.now()
		const previous = this.samples.get(id)
		let speed = previous?.speedBps || 0
		if (!previous || bytes < previous.bytes) this.resetSample(id, bytes)
		else if (bytes > previous.bytes && now - previous.ts >= 250) {
			const instant = (bytes - previous.bytes) * 1000 / (now - previous.ts)
			speed = speed ? speed * 0.35 + instant * 0.65 : instant
			this.samples.set(id, { bytes, ts: now, speedBps: speed })
		}
		return { id, messageId: messageIdValue, status, progress: total ? bytes / total : 1, transferredBytes: bytes, speedBps: speed || undefined, etaSeconds: speed && bytes < total ? (total - bytes) / speed : undefined }
	}

	private resetSample(id: string, bytes: number) {
		this.samples.set(id, { bytes, ts: Date.now(), speedBps: 0 })
	}

	private isLocalMobile() {
		const context = this.deps.getContext()
		const platform = context?.localCapability?.platform
		return context?.session.localPeer.deviceType !== 'desktop' || platform === 'android' || platform === 'ios'
	}

	private abortActive() {
		if (!this.activeController?.signal.aborted) this.activeController?.abort()
		if (this.activeTask) this.sendBarrier = Promise.all([this.sendBarrier, this.activeTask.catch(() => {})]).then(() => {})
	}

	private clearResumeSync() {
		if (this.resumeSync?.timer) clearTimeout(this.resumeSync.timer)
		this.resumeSync = null
	}

	private fail(id: string, messageIdValue: string | undefined, reason: string, notifyPeer = true) {
		if (this.activeSending === id) this.abortActive()
		this.deps.emit({ type: 'attachment-patch', patch: { id, messageId: messageIdValue, status: 'failed', error: reason } })
		this.deps.emit({ type: 'file-record-patch', id, patch: { status: 'failed' } })
		if (notifyPeer) this.deps.sendControl({ ...this.deps.controlBase('attachment-cancel'), id, messageId: messageIdValue, reason })
		this.prepared.delete(id)
		if (this.activeSending === id) this.activeSending = null
		this.queue = this.queue.filter(item => item !== id)
		this.samples.delete(id)
		this.deps.onActivityChange()
		this.deps.setStatus(reason)
	}
}
