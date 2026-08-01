import { selectStorageForFile } from './capability'
import { messageId } from './file-transfer'
import type { LanStorageEngine, TransferFileMeta } from './storage/types'
import type { LanNativeLocalAgentPort, LanNativePeerBulkPort } from './native-agent/ports'
import { selectLocalNetworkAccessFileEndpoint } from './native-agent/peer-lna-http'
import { endpointAddressKind, validLanFileWebTransportEndpoint } from './native-agent/endpoint-validation'
import { NATIVE_FILE_IO_BLOCK_BYTES } from './native-agent/native-storage-writer'
import type { LanNativeSelectedFile, LanNativeTransferEvent, LanNativeTransferGrant } from './native-agent/types'
import { LAN_PROTOCOL_VERSION } from './types'
import type {
	LanAttachment,
	LanAttachmentManifest,
	LanAttachmentOffer,
	LanBulkDataPlane,
	LanCapability,
	LanControlMessage,
	LanNativeTransferReady,
	LanNativeTransferFallback,
	LanNativeTransferRequest,
	LanStorageKind,
} from './types'

export const LAN_NATIVE_FILE_MIN_BYTES = 64 * 1024 * 1024

type NativeContext = {
	localDeviceId: string
	peerDeviceId: string
	localCapability: LanCapability | null
	remoteCapability: LanCapability | null
	localPort: LanNativeLocalAgentPort | null
}

type PreparedStorage = { engine: LanStorageEngine; meta: TransferFileMeta }

type NativeRuntimeHost = {
	context: () => NativeContext | null
	peerBulk: LanNativePeerBulkPort
	controlBase: <T extends LanControlMessage['type']>(type: T, createdAt?: number) => { type: T; protocolVersion: typeof LAN_PROTOCOL_VERSION; peerId: string; seq: number; createdAt: number }
	sendControl: (message: LanControlMessage) => boolean
	prepareStorage: (offer: LanAttachmentOffer) => Promise<PreparedStorage>
	createAttachment: (messageId: string, createdAt: number, direction: 'in' | 'out', attachment: LanAttachment) => void
	patchAttachment: (id: string, messageId: string, patch: Partial<LanAttachment>) => void
	patchFile: (id: string, patch: { status?: LanAttachment['status']; storage?: LanStorageKind; url?: string }) => void
	downloadReady: (name: string, url: string) => void
	status: (message: string) => void
	fallbackBrowserFile: (options: { file: File; attachmentId: string; messageId: string; createdAt: number }) => Promise<void>
}

type NativeOutgoingBase = {
	manifest: LanAttachmentManifest
	messageId: string
	createdAt: number
	transferId?: string
	abort?: AbortController
}

type NativeOutgoing = NativeOutgoingBase & ({ source: 'agent'; sourceId: string } | { source: 'browser'; file: File })

type NativeIncoming = {
	offer: LanAttachmentOffer
	storage?: PreparedStorage
	transferId?: string
	abort?: AbortController
	lastProgress?: { bytes: number; at: number }
}

export class LanNativeFileRuntime {
	private outgoing = new Map<string, NativeOutgoing>()
	private incoming = new Map<string, NativeIncoming>()
	private activeOutgoingId = ''
	private unsubscribeAgent: (() => void) | null = null
	private subscribedPort: LanNativeLocalAgentPort | null = null
	private objectUrls: string[] = []

	constructor(private readonly host: NativeRuntimeHost) {}

	hasActiveTransfer() {
		return this.outgoing.size > 0 || this.incoming.size > 0
	}

	attach() {
		this.ensureAgentSubscription()
		this.flushNextOffer()
	}

	reset() {
		const port = this.subscribedPort
		this.unsubscribeAgent?.()
		this.unsubscribeAgent = null
		this.subscribedPort = null
		this.outgoing.forEach(entry => {
			entry.abort?.abort()
			if (entry.transferId) void port?.cancelTransfer(entry.transferId).catch(() => {})
			else if (entry.source === 'agent') void port?.releaseSource(entry.sourceId).catch(() => {})
		})
		this.incoming.forEach(entry => {
			entry.abort?.abort()
			if (entry.transferId) void port?.cancelTransfer(entry.transferId).catch(() => {})
			if (entry.storage) void entry.storage.engine.cleanup(entry.storage.meta.id).catch(() => {})
		})
		this.outgoing.clear()
		this.incoming.clear()
		this.activeOutgoingId = ''
		this.objectUrls.forEach(url => URL.revokeObjectURL(url))
		this.objectUrls = []
	}

	async trySendBrowserFiles(files: File[]) {
		const context = this.host.context()
		const advertisement = context?.remoteCapability?.nativeAgent
		if (!context || !advertisement || advertisement.fileVersion !== 1) return files
		const remaining: File[] = []
		for (const file of files) {
			if (file.size < LAN_NATIVE_FILE_MIN_BYTES || file.type.startsWith('image/')) {
				remaining.push(file)
				continue
			}
			try {
				const dataPlane = await selectNativeDataPlane(advertisement.fileHttpEndpoints, advertisement.fileWebTransportEndpoints, Boolean(context.localCapability?.webTransport))
				this.addOutgoing(this.browserOutgoing(file, dataPlane, Date.now()))
			} catch {
				remaining.push(file)
			}
		}
		this.flushNextOffer()
		return remaining
	}

	async selectAgentFiles() {
		const context = this.host.context()
		const port = context?.localPort
		if (!context || !port) throw new Error('本机加速组件未连接')
		this.ensureAgentSubscription()
		const selected = await port.selectFiles()
		for (const file of selected) {
			if (file.size < LAN_NATIVE_FILE_MIN_BYTES || file.mime.startsWith('image/')) {
				await port.releaseSource(file.sourceId).catch(() => {})
				this.host.status(file.mime.startsWith('image/') ? `${file.name} 请使用图片按钮发送` : `${file.name} 小于 64MiB，请关闭极速模式或使用网页文件选择器发送`)
				continue
			}
			this.addOutgoing(this.agentOutgoing(file, Date.now()))
		}
		this.flushNextOffer()
	}

	handleOffer(offer: LanAttachmentOffer) {
		if (offer.attachment.dataPlane === 'webrtc') return false
		this.incoming.set(offer.attachment.id, { offer })
		const attachment = attachmentFromManifest(offer.attachment, 'in', 'offered')
		this.host.createAttachment(offer.messageId, offer.createdAt, 'in', attachment)
		this.host.status(`${offer.attachment.name} 等待下载`)
		return true
	}

	async accept(id: string) {
		const incoming = this.incoming.get(id)
		const context = this.host.context()
		if (!incoming || !context) return false
		const offer = incoming.offer
		try {
			if (offer.nativeSource === 'browser') {
				const port = context.localPort
				if (!port || offer.agentOwnerDeviceId !== context.localDeviceId) throw new Error('本机 Agent 未连接，不能直接保存该极速文件')
				this.ensureAgentSubscription()
				const grant = await port.prepareReceiveTransfer({
					attachmentId: id,
					ownerDeviceId: context.localDeviceId,
					peerDeviceId: context.peerDeviceId,
					name: offer.attachment.name,
					totalBytes: offer.attachment.size,
					dataPlane: offer.attachment.dataPlane as Exclude<LanBulkDataPlane, 'webrtc'>,
				})
				if (!grant) throw new DOMException('用户取消了保存位置', 'AbortError')
				incoming.transferId = grant.transferId
				this.patchProgress(incoming, 0)
				this.host.sendControl({ ...this.host.controlBase('native-transfer-ready'), id, messageId: offer.messageId, grant })
				this.host.status(`正在接收 ${offer.attachment.name}`)
				return true
			}

			const storage = await this.host.prepareStorage(offer)
			incoming.storage = storage
			const advertisement = context.remoteCapability?.nativeAgent
			if (!advertisement || advertisement.ownerDeviceId !== offer.agentOwnerDeviceId) throw new Error('加速电脑信息已经变化，请重新发送')
			const dataPlane = await selectNativeDataPlane(advertisement.fileHttpEndpoints, advertisement.fileWebTransportEndpoints, Boolean(context.localCapability?.webTransport))
			offer.attachment.dataPlane = dataPlane
			this.host.patchAttachment(id, offer.messageId, { dataPlane, storage: storage.engine.kind, status: 'receiving' })
			this.host.patchFile(id, { storage: storage.engine.kind, status: 'receiving' })
			this.host.sendControl({ ...this.host.controlBase('native-transfer-request'), id, messageId: offer.messageId, dataPlane })
			return true
		} catch (error) {
			await this.failIncoming(incoming, error)
			return true
		}
	}

	async handleRequest(message: LanNativeTransferRequest) {
		const outgoing = this.outgoing.get(message.id)
		const context = this.host.context()
		const port = context?.localPort
		if (!outgoing || outgoing.source !== 'agent' || !context || !port || outgoing.messageId !== message.messageId) return
		try {
			const grant = await port.createSendTransfer({
				sourceId: outgoing.sourceId,
				attachmentId: message.id,
				ownerDeviceId: context.localDeviceId,
				peerDeviceId: context.peerDeviceId,
				dataPlane: message.dataPlane,
			})
			outgoing.transferId = grant.transferId
			outgoing.manifest.dataPlane = message.dataPlane
			this.host.patchAttachment(message.id, message.messageId, { dataPlane: message.dataPlane, status: 'sending' })
			this.host.sendControl({ ...this.host.controlBase('native-transfer-ready'), id: message.id, messageId: message.messageId, grant })
		} catch (error) {
			this.failOutgoing(outgoing, error instanceof Error ? error.message : 'Agent 无法创建文件授权')
		}
	}

	async handleReady(message: LanNativeTransferReady) {
		const context = this.host.context()
		if (!context) return
		const outgoing = this.outgoing.get(message.id)
		if (outgoing?.source === 'browser') {
			let transferred = 0
			try {
				validateGrant(message.grant, outgoing.manifest, context.peerDeviceId)
				outgoing.transferId = message.grant.transferId
				outgoing.abort = new AbortController()
				this.host.patchAttachment(message.id, message.messageId, { status: 'sending', phase: 'transferring' })
				await this.host.peerBulk.upload({
					grant: message.grant,
					peerDeviceId: context.localDeviceId,
					file: outgoing.file,
					signal: outgoing.abort.signal,
					onProgress: bytes => {
						transferred = Math.max(transferred, bytes)
						this.patchOutgoingProgress(outgoing, bytes)
					}
				})
				if (!this.outgoing.has(message.id)) return
				this.host.patchAttachment(message.id, message.messageId, { status: 'sending', phase: 'confirming', transferredBytes: outgoing.manifest.size, progress: 1, speedBps: undefined, etaSeconds: undefined })
				this.host.status(`已发送 ${outgoing.manifest.name}，等待 Agent 保存确认`)
			} catch (error) {
				const reason = error instanceof Error ? error.message : '极速文件上传失败'
				const fallbackReason = transferred > 0 ? `${reason}；将从 0 重新传输` : reason
				if (!isUserCancel(error)) await this.fallbackBrowserOutgoing(outgoing, fallbackReason)
				else this.failOutgoing(outgoing, reason)
			}
			return
		}

		const incoming = this.incoming.get(message.id)
		if (!incoming?.storage) return
		try {
			validateGrant(message.grant, incoming.offer.attachment, incoming.offer.agentOwnerDeviceId || '')
			incoming.transferId = message.grant.transferId
			incoming.abort = new AbortController()
			await this.host.peerBulk.download({
				grant: message.grant,
				peerDeviceId: context.localDeviceId,
				meta: incoming.storage.meta,
				storage: incoming.storage.engine,
				signal: incoming.abort.signal,
				onProgress: bytes => this.patchIncomingProgress(incoming, bytes),
			})
			const finalized = await incoming.storage.engine.finalize(incoming.storage.meta)
			this.host.patchAttachment(message.id, message.messageId, { status: 'complete', progress: 1, transferredBytes: incoming.offer.attachment.size, phase: undefined, speedBps: undefined, etaSeconds: undefined, url: finalized.url })
			this.host.patchFile(message.id, { status: 'complete', url: finalized.url })
			this.host.sendControl({ ...this.host.controlBase('attachment-received'), id: message.id, messageId: message.messageId, received: incoming.offer.attachment.size, expected: incoming.offer.attachment.size, chunkCount: incoming.offer.attachment.chunkCount, storage: incoming.storage.engine.kind })
			if (finalized.url && !finalized.directSave) this.host.downloadReady(incoming.offer.attachment.name, finalized.url)
			this.incoming.delete(message.id)
			this.host.status('极速文件接收完成')
		} catch (error) {
			await this.failIncoming(incoming, error)
		}
	}

	async handleFallback(message: LanNativeTransferFallback) {
		const incoming = this.incoming.get(message.id)
		if (!incoming || incoming.offer.messageId !== message.messageId) return
		this.incoming.delete(message.id)
		incoming.abort?.abort()
		if (incoming.transferId) await this.host.context()?.localPort?.cancelTransfer(incoming.transferId).catch(() => {})
		if (incoming.storage) await incoming.storage.engine.cleanup(incoming.storage.meta.id).catch(() => {})
		this.host.patchAttachment(message.id, message.messageId, { dataPlane: 'webrtc', status: 'queued', progress: 0, transferredBytes: 0, phase: undefined, error: undefined })
		this.host.patchFile(message.id, { status: 'queued' })
		this.host.status(`${incoming.offer.attachment.name} 极速直连失败，自动切换 WebRTC`)
	}

	async handleReceived(id: string, messageIdValue: string, received: number, expected: number) {
		const outgoing = this.outgoing.get(id)
		if (!outgoing || outgoing.messageId !== messageIdValue) return false
		if (received !== outgoing.manifest.size || expected !== outgoing.manifest.size) {
			this.failOutgoing(outgoing, '接收结果与极速文件大小不一致')
			return true
		}
		if (outgoing.source === 'agent' && outgoing.transferId) await this.host.context()?.localPort?.finishSendTransfer(outgoing.transferId).catch(() => {})
		this.host.patchAttachment(id, messageIdValue, { status: 'complete', progress: 1, transferredBytes: outgoing.manifest.size, phase: undefined, speedBps: undefined, etaSeconds: undefined })
		this.host.patchFile(id, { status: 'complete' })
		this.removeOutgoing(id)
		this.host.status('对方已收到极速文件')
		return true
	}

	handleCancel(id: string, reason: string) {
		const outgoing = this.outgoing.get(id)
		if (outgoing) this.failOutgoing(outgoing, reason, false)
		const incoming = this.incoming.get(id)
		if (incoming) void this.failIncoming(incoming, new Error(reason), false)
		return Boolean(outgoing || incoming)
	}

	private addOutgoing(outgoing: NativeOutgoing) {
		this.outgoing.set(outgoing.manifest.id, outgoing)
		const attachment = attachmentFromManifest(outgoing.manifest, 'out', 'queued')
		if (outgoing.source === 'browser') {
			const url = URL.createObjectURL(outgoing.file)
			attachment.url = url
			this.objectUrls.push(url)
		}
		this.host.createAttachment(outgoing.messageId, outgoing.createdAt, 'out', attachment)
	}

	private flushNextOffer() {
		if (this.activeOutgoingId || !this.host.context()) return
		const outgoing = this.outgoing.values().next().value
		if (!outgoing) return
		const id = outgoing.manifest.id
		const context = this.host.context()!
		const sent = this.host.sendControl({
			...this.host.controlBase('attachment-offer', outgoing.createdAt),
			messageId: outgoing.messageId,
			attachment: outgoing.manifest,
			nativeSource: outgoing.source,
			agentOwnerDeviceId: outgoing.source === 'agent' ? context.localDeviceId : context.peerDeviceId,
		})
		if (!sent) return
		this.activeOutgoingId = id
		this.host.patchAttachment(id, outgoing.messageId, { status: 'offered' })
		this.host.status(`等待对方下载 ${outgoing.manifest.name}`)
	}

	private ensureAgentSubscription() {
		const port = this.host.context()?.localPort || null
		if (port === this.subscribedPort) return
		this.unsubscribeAgent?.()
		this.unsubscribeAgent = null
		this.subscribedPort = port
		if (port) this.unsubscribeAgent = port.subscribe(event => this.handleAgentEvent(event))
	}

	private handleAgentEvent(event: LanNativeTransferEvent) {
		if (event.type === 'transfer-progress' || event.type === 'transfer-confirming') {
			const outgoing = this.outgoing.get(event.attachmentId)
			if (outgoing) this.patchOutgoingProgress(outgoing, event.bytes)
			else {
				const incoming = this.incoming.get(event.attachmentId)
				if (incoming) this.patchIncomingProgress(incoming, event.bytes)
			}
			return
		}
		if (event.type === 'transfer-complete') {
			const incoming = this.incoming.get(event.attachmentId)
			if (!incoming || incoming.offer.nativeSource !== 'browser') return
			const offer = incoming.offer
			this.host.patchAttachment(offer.attachment.id, offer.messageId, { status: 'complete', progress: 1, transferredBytes: offer.attachment.size, phase: undefined, speedBps: undefined, etaSeconds: undefined })
			this.host.patchFile(offer.attachment.id, { status: 'complete' })
			this.host.sendControl({ ...this.host.controlBase('attachment-received'), id: offer.attachment.id, messageId: offer.messageId, received: offer.attachment.size, expected: offer.attachment.size, chunkCount: offer.attachment.chunkCount, storage: 'file' })
			this.incoming.delete(offer.attachment.id)
			this.host.status('极速文件已保存')
			return
		}
		if (event.type === 'transfer-failed' || event.type === 'transfer-cancelled') {
			const incoming = this.incoming.get(event.attachmentId)
			if (incoming) void this.failIncoming(incoming, new Error(event.type === 'transfer-failed' ? event.error : '极速文件已取消'))
			const outgoing = this.outgoing.get(event.attachmentId)
			if (outgoing) this.failOutgoing(outgoing, event.type === 'transfer-failed' ? event.error : '极速文件已取消')
		}
	}

	private patchOutgoingProgress(outgoing: NativeOutgoing, bytes: number) {
		this.host.patchAttachment(outgoing.manifest.id, outgoing.messageId, { status: 'sending', phase: bytes >= outgoing.manifest.size ? 'confirming' : 'transferring', progress: Math.min(1, bytes / outgoing.manifest.size), transferredBytes: Math.min(bytes, outgoing.manifest.size) })
	}

	private patchIncomingProgress(incoming: NativeIncoming, bytes: number) {
		const now = Date.now()
		const total = incoming.offer.attachment.size
		if (bytes < total && incoming.lastProgress && bytes - incoming.lastProgress.bytes < 32 * 1024 * 1024 && now - incoming.lastProgress.at < 250) return
		incoming.lastProgress = { bytes, at: now }
		this.patchProgress(incoming, bytes)
	}

	private patchProgress(incoming: NativeIncoming, bytes: number) {
		const total = incoming.offer.attachment.size
		this.host.patchAttachment(incoming.offer.attachment.id, incoming.offer.messageId, { status: 'receiving', phase: bytes >= total ? 'confirming' : 'transferring', progress: Math.min(1, bytes / total), transferredBytes: Math.min(bytes, total) })
	}

	private async failIncoming(incoming: NativeIncoming, error: unknown, notify = true) {
		const cancelled = isUserCancel(error)
		const reason = cancelled ? '已取消下载' : error instanceof Error ? error.message : '极速文件接收失败'
		incoming.abort?.abort()
		if (incoming.transferId) await this.host.context()?.localPort?.cancelTransfer(incoming.transferId).catch(() => {})
		if (incoming.storage) await incoming.storage.engine.cleanup(incoming.storage.meta.id).catch(() => {})
		const id = incoming.offer.attachment.id
		this.incoming.delete(id)
		this.host.patchAttachment(id, incoming.offer.messageId, { status: cancelled ? 'cancelled' : 'failed', error: reason, phase: undefined })
		this.host.patchFile(id, { status: cancelled ? 'cancelled' : 'failed' })
		if (notify) this.host.sendControl({ ...this.host.controlBase('attachment-cancel'), id, messageId: incoming.offer.messageId, reason })
		this.host.status(reason)
	}

	private failOutgoing(outgoing: NativeOutgoing, reason: string, notify = true) {
		outgoing.abort?.abort()
		const port = this.host.context()?.localPort
		if (outgoing.transferId) void port?.cancelTransfer(outgoing.transferId).catch(() => {})
		else if (outgoing.source === 'agent') void port?.releaseSource(outgoing.sourceId).catch(() => {})
		this.host.patchAttachment(outgoing.manifest.id, outgoing.messageId, { status: 'failed', error: reason, phase: undefined })
		this.host.patchFile(outgoing.manifest.id, { status: 'failed' })
		if (notify) this.host.sendControl({ ...this.host.controlBase('attachment-cancel'), id: outgoing.manifest.id, messageId: outgoing.messageId, reason })
		this.removeOutgoing(outgoing.manifest.id)
		this.host.status(reason)
	}

	private async fallbackBrowserOutgoing(outgoing: Extract<NativeOutgoing, { source: 'browser' }>, reason: string) {
		outgoing.abort?.abort()
		const port = this.host.context()?.localPort
		if (outgoing.transferId) await port?.cancelTransfer(outgoing.transferId).catch(() => {})
		const announced = this.host.sendControl({
			...this.host.controlBase('native-transfer-fallback'),
			id: outgoing.manifest.id,
			messageId: outgoing.messageId,
			reason,
		})
		this.outgoing.delete(outgoing.manifest.id)
		if (this.activeOutgoingId === outgoing.manifest.id) this.activeOutgoingId = ''
		try {
			if (!announced) throw new Error('无法通知对方切换普通直连')
			await this.host.fallbackBrowserFile({
				file: outgoing.file,
				attachmentId: outgoing.manifest.id,
				messageId: outgoing.messageId,
				createdAt: outgoing.createdAt,
			})
			this.host.status(`${outgoing.manifest.name} 极速直连失败，已自动切换 WebRTC`)
		} catch (error) {
			const fallbackReason = error instanceof Error ? error.message : 'WebRTC 回退失败'
			this.host.patchAttachment(outgoing.manifest.id, outgoing.messageId, { status: 'failed', error: fallbackReason, phase: undefined })
			this.host.patchFile(outgoing.manifest.id, { status: 'failed' })
			this.host.status(fallbackReason)
		}
		this.flushNextOffer()
	}

	private removeOutgoing(id: string) {
		this.outgoing.delete(id)
		if (this.activeOutgoingId === id) this.activeOutgoingId = ''
		this.flushNextOffer()
	}

	private browserOutgoing(file: File, dataPlane: Exclude<LanBulkDataPlane, 'webrtc'>, createdAt: number): NativeOutgoing {
		const context = this.host.context()!
		return {
			manifest: manifestFromFile(file, dataPlane, selectStorageForFile(file.size, context.remoteCapability)),
			messageId: messageId(),
			createdAt,
			source: 'browser',
			file,
		}
	}

	private agentOutgoing(file: LanNativeSelectedFile, createdAt: number): NativeOutgoing {
		return {
			manifest: { id: messageId(), kind: 'file', name: file.name, mime: file.mime, size: file.size, lastModified: file.lastModified, chunkSize: NATIVE_FILE_IO_BLOCK_BYTES, chunkCount: Math.ceil(file.size / NATIVE_FILE_IO_BLOCK_BYTES), suggestedStorage: 'file', dataPlane: 'native-lna-http' },
			messageId: messageId(),
			createdAt,
			source: 'agent',
			sourceId: file.sourceId,
		}
	}
}

function manifestFromFile(file: File, dataPlane: Exclude<LanBulkDataPlane, 'webrtc'>, storage: LanStorageKind): LanAttachmentManifest {
	return { id: messageId(), kind: 'file', name: file.name || 'received-file', mime: file.type || 'application/octet-stream', size: file.size, lastModified: file.lastModified || Date.now(), chunkSize: NATIVE_FILE_IO_BLOCK_BYTES, chunkCount: Math.ceil(file.size / NATIVE_FILE_IO_BLOCK_BYTES), suggestedStorage: storage, dataPlane }
}

function attachmentFromManifest(manifest: LanAttachmentManifest, direction: 'in' | 'out', status: LanAttachment['status']): LanAttachment {
	return { ...manifest, direction, storage: manifest.suggestedStorage, status, progress: 0 }
}

function validateGrant(grant: LanNativeTransferGrant, manifest: LanAttachmentManifest, ownerDeviceId: string) {
	const dataPlane = grant.authorization.kind === 'lna-http' ? 'native-lna-http' : 'native-webtransport'
	if (grant.attachmentId !== manifest.id || grant.ownerDeviceId !== ownerDeviceId || dataPlane !== manifest.dataPlane) throw new Error('极速文件授权与附件不匹配')
}

async function selectNativeDataPlane(fileHttpEndpoints: string[], fileWebTransportEndpoints: string[], webTransport: boolean): Promise<Exclude<LanBulkDataPlane, 'webrtc'>> {
	const lna = await selectLocalNetworkAccessFileEndpoint(fileHttpEndpoints)
	if (lna.state === 'available') return 'native-lna-http'
	const endpoints = fileWebTransportEndpoints.filter(validLanFileWebTransportEndpoint)
	const publicIpv6Available = endpoints.some(endpoint => endpointAddressKind(endpoint) === 'gua-ipv6')
	if (webTransport && endpoints.length && (lna.state !== 'denied' || publicIpv6Available)) return 'native-webtransport'
	throw new Error(lna.state === 'denied' ? '本地网络权限已拒绝，且没有可用的公网 IPv6 极速地址' : lna.state === 'unavailable' ? lna.reason : '当前浏览器不支持极速文件通道')
}

function isUserCancel(error: unknown) {
	const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name || '') : ''
	return name === 'AbortError' || name === 'NotAllowedError'
}
