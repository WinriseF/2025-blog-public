import { detectLanCapability } from './capability'
import { LanAttachmentReceiver } from './attachment-receiver'
import { LanAttachmentSender } from './attachment-sender'
import { historyMessageForSync, historyMessageFromRemote } from './connection-runtime-helpers'
import type { LanConnectionRuntimeEvent, RuntimeContext, SendFilesOptions } from './connection-runtime-types'
import { decodeChunk, decodeControl, encodeControl, messageId } from './file-transfer'
import type { LanConnectionTransport } from './transport-types'
import { LAN_LIMITS, LAN_PROTOCOL_VERSION, type LanControlMessage } from './types'

export type { LanConnectionRuntimeEvent } from './connection-runtime-types'

type RuntimeListener = (event: LanConnectionRuntimeEvent) => void

export class LanConnectionRuntime {
	private listeners = new Set<RuntimeListener>()
	private transport: LanConnectionTransport | null = null
	private transportEpoch = 0
	private context: RuntimeContext | null = null
	private seq = 0
	private outgoingTextIds = new Set<string>()
	private deliveredTextIds = new Set<string>()
	private diagnosticsTimer: ReturnType<typeof setInterval> | null = null
	private destroyed = false
	private readonly sender = new LanAttachmentSender({
		getContext: () => this.context,
		getTransport: () => this.transport,
		getTransportEpoch: () => this.transportEpoch,
		controlBase: (type, createdAt) => this.controlBase(type, createdAt),
		sendControl: message => this.sendControl(message),
		emit: event => this.emit(event),
		setStatus: message => this.setStatus(message),
		onActivityChange: () => this.syncActivity(),
	})
	private readonly receiver = new LanAttachmentReceiver({
		getContext: () => this.context,
		getLocalCapability: size => this.detectLocalCapability(size),
		getTransportEpoch: () => this.transportEpoch,
		controlBase: (type, createdAt) => this.controlBase(type, createdAt),
		sendControl: message => this.sendControl(message),
		emit: event => this.emit(event),
		setStatus: message => this.setStatus(message),
		onActivityChange: () => this.syncActivity(),
	})

	subscribe(listener: RuntimeListener) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	attachTransport(transport: LanConnectionTransport, context: RuntimeContext) {
		if (this.destroyed) return
		this.transportEpoch += 1
		this.transport = transport
		this.context = context
		if (context.localCapability) this.emit({ type: 'local-capability', capability: context.localCapability })
		if (context.remoteCapability) this.emit({ type: 'remote-capability', capability: context.remoteCapability })
		this.sender.prepareForResume()
		this.startDiagnostics()
		this.resumeHandshake()
	}

	recoverTransport(transportId: string) {
		if (this.destroyed || this.transport?.id !== transportId) return
		this.transportEpoch += 1
		this.receiver.discardPending()
		this.sender.prepareForResume()
		this.resumeHandshake()
	}

	detachTransport() {
		this.sender.detach()
		this.receiver.discardPending()
		this.transport?.setTransferActive(false)
		this.transportEpoch += 1
		this.transport = null
		this.stopDiagnostics()
	}

	destroy() {
		if (this.destroyed) return
		this.destroyed = true
		this.detachTransport()
		this.sender.destroy()
		this.receiver.destroy()
		this.outgoingTextIds.clear()
		this.deliveredTextIds.clear()
		this.context = null
		this.listeners.clear()
	}

	handleControlFrame(data: unknown) {
		const message = decodeControl(data)
		const epoch = this.transportEpoch
		if (message) void this.handleControl(message, epoch).catch(error => this.setStatus(error instanceof Error ? error.message : '消息处理失败'))
	}

	handleDataFrame(data: unknown) {
		const frame = decodeChunk(data)
		if (frame) this.receiver.handleChunk(frame.id, frame.index, frame.bytes)
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

	sendFiles(files: File[], options: SendFilesOptions = {}) {
		return this.sender.sendFiles(files, options)
	}

	acceptAttachment(id: string) {
		return this.receiver.accept(id)
	}

	private emit(event: LanConnectionRuntimeEvent) {
		if (!this.destroyed) this.listeners.forEach(listener => listener(event))
	}

	private setStatus(message: string) {
		this.emit({ type: 'status', message })
	}

	private isOpen() {
		return Boolean(this.transport?.isOpen())
	}

	private controlBase<T extends LanControlMessage['type']>(type: T, createdAt = Date.now()): { type: T; protocolVersion: typeof LAN_PROTOCOL_VERSION; peerId: string; seq: number; createdAt: number } {
		this.seq += 1
		return { type, protocolVersion: LAN_PROTOCOL_VERSION, peerId: this.context?.session.instanceId || '', seq: this.seq, createdAt }
	}

	private sendControl(message: LanControlMessage) {
		return Boolean(this.transport?.isOpen() && this.transport.sendControl(encodeControl(message)))
	}

	private async detectLocalCapability(fileSize = 0) {
		const context = this.context
		if (!context) throw new Error('请先连接设备')
		const capability = await detectLanCapability(context.session.instanceId, fileSize)
		context.localCapability = capability
		this.emit({ type: 'local-capability', capability })
		return capability
	}

	private async sendLocalCapability(epoch: number) {
		const capability = this.context?.localCapability || await this.detectLocalCapability()
		if (epoch === this.transportEpoch) this.sendControl({ ...capability, ...this.controlBase('capability') })
	}

	private resumeHandshake() {
		if (!this.isOpen()) return
		const epoch = this.transportEpoch
		void this.sendLocalCapability(epoch).then(() => {
			if (epoch !== this.transportEpoch || !this.isOpen()) return
			this.sendChatHistory()
			this.sender.startResume()
		}).catch(() => {
			if (epoch === this.transportEpoch) {
				this.setStatus('连接同步失败，正在重新发送文件请求')
				this.sender.startResume()
			}
		})
	}

	private sendChatHistory() {
		const messages = this.context?.getHistory?.() || []
		if (messages.length) this.sendControl({ ...this.controlBase('chat-history'), messages: messages.map(historyMessageForSync) })
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

	private async handleControl(message: LanControlMessage, transportEpoch: number) {
		if (this.destroyed || transportEpoch !== this.transportEpoch) return
		if (message.protocolVersion !== LAN_PROTOCOL_VERSION) return this.setStatus('双方页面不一致，请刷新后重试')
		if (message.type === 'capability') {
			if (this.context) this.context.remoteCapability = message
			this.emit({ type: 'remote-capability', capability: message })
			this.setStatus('已连接，可以发送消息和文件')
			return
		}
		if (message.type === 'chat-message') {
			if (!message.id) return
			this.emit({ type: 'message-upsert', message: { id: message.id, direction: 'in', kind: 'text', text: message.text, attachments: [], status: 'received', createdAt: message.createdAt, peerId: message.peerId } })
			return void this.sendChatReceipt([message.id])
		}
		if (message.type === 'chat-receipt') return void this.markTextDelivered(message.messageIds)
		if (message.type === 'chat-history') {
			this.emit({ type: 'history-merge', messages: message.messages.map(historyMessageFromRemote) })
			this.markTextDelivered(message.messages.filter(item => item.kind === 'text' && item.direction === 'in').map(item => item.id))
			return void this.sendChatReceipt(message.messages.filter(item => item.kind === 'text' && item.direction === 'out').map(item => item.id))
		}
		if (message.type === 'attachment-offer') return void (await this.receiver.handleOffer(message, transportEpoch))
		if (message.type === 'attachment-accept') return void this.sender.handleAccept(message)
		if (message.type === 'attachment-progress') return void this.sender.handleProgress(message)
		if (message.type === 'attachment-complete') return void (await this.receiver.finish(message.id, message.messageId, message.sent, message.chunkCount, transportEpoch))
		if (message.type === 'attachment-received') return void this.sender.handleReceived(message)
		if (message.type === 'attachment-cancel') {
			this.sender.cancel(message.id, message.messageId, message.reason || '已取消')
			this.receiver.cancel(message.id, message.messageId, message.reason || '已取消')
			return
		}
		if (message.type === 'resume-query') {
			const transport = this.transport
			if (!transport || message.transportGeneration !== transport.generation) return
			const epoch = this.transportEpoch
			const attachments = this.receiver.resumeState(message.ids)
			if (epoch === this.transportEpoch && this.transport === transport) this.sendControl({ ...this.controlBase('resume-state'), resumeId: message.resumeId, transportGeneration: message.transportGeneration, transportEpoch: message.transportEpoch, attachments })
			return
		}
		if (message.type === 'resume-state') this.sender.handleResumeState(message)
	}

	private syncActivity() {
		this.transport?.setTransferActive(this.sender.isActive() || this.receiver.isActive())
	}

	private startDiagnostics() {
		this.stopDiagnostics()
		this.emitDiagnostics()
		this.diagnosticsTimer = setInterval(() => this.emitDiagnostics(), LAN_LIMITS.diagnosticsIntervalMs)
	}

	private stopDiagnostics() {
		if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer)
		this.diagnosticsTimer = null
	}

	private emitDiagnostics() {
		const transport = this.transport
		if (!transport) return
		const transportStats = transport.getDiagnostics()
		const receiver = this.receiver.diagnostics()
		const sender = this.sender.diagnostics()
		const flow = receiver.active ? receiver : sender
		const mobile = this.context?.session.localPeer.deviceType !== 'desktop'
		this.emit({
			type: 'diagnostics',
			diagnostics: {
				active: receiver.active || sender.active,
				chunkSize: transportStats.chunkSize,
				networkSendBps: transportStats.networkSendBps,
				networkReceiveBps: transportStats.networkReceiveBps,
				dataChannelBufferedBytes: transportStats.dataBufferedAmount,
				queuedBytes: flow.queuedBytes,
				receiveWindowBytes: flow.receiveWindowBytes,
				diskCommitBps: receiver.diskCommitBps,
				pausedReason: flow.pausedReason,
				bufferHighWatermark: mobile ? LAN_LIMITS.mobileBufferHighWatermark : LAN_LIMITS.bufferHighWatermark,
				bufferLowWatermark: mobile ? LAN_LIMITS.mobileBufferLowWatermark : LAN_LIMITS.bufferLowWatermark,
				maxUncommittedBytes: mobile ? LAN_LIMITS.mobileMaxSenderAheadBytes : LAN_LIMITS.maxSenderAheadBytes,
			},
		})
	}
}
