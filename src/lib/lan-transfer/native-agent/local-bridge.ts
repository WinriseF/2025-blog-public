import type { LanNativeLocalAgentPort } from './ports'
import type {
	LanNativeAgentCallback,
	LanNativeAgentTicket,
	LanNativeFileDataPlane,
	LanNativeSelectedFile,
	LanNativeTransferEvent,
	LanNativeTransferGrant,
} from './types'
import {
	NATIVE_AGENT_BENCHMARK_VERSION,
	NATIVE_AGENT_BRIDGE_VERSION,
	NATIVE_AGENT_FILE_VERSION,
	NATIVE_AGENT_LNA_HTTP_VERSION,
} from './types'
import { createPinnedWebTransport, ExactStreamReader, withTimeout, type WebTransportLike } from './webtransport'

const MAX_BRIDGE_FRAME_BYTES = 64 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type BridgeResponse = { type: 'response'; requestId: number; ok: boolean; result?: unknown; error?: string }
type BridgeHelloAck = { type: 'hello-ack'; version: number; accepted: boolean; error?: string }

export class LanNativeLocalBridge implements LanNativeLocalAgentPort {
	private requestId = 0
	private writeQueue = Promise.resolve()
	private closed = false
	private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
	private listeners = new Set<(event: LanNativeTransferEvent) => void>()
	private transferQueue = Promise.resolve()
	private transferReleases = new Map<string, () => void>()

	private constructor(
		private readonly transport: WebTransportLike,
		private readonly writer: WritableStreamDefaultWriter<Uint8Array>,
		private readonly reader: ExactStreamReader,
		readonly callback: LanNativeAgentCallback
	) {}

	static async connect(callback: LanNativeAgentCallback) {
		const transport = createPinnedWebTransport(callback.bridgeEndpoint, callback.certificateSha256)
		await withTimeout(transport.ready, 8_000, '连接本机加速组件超时')
		const control = await transport.createBidirectionalStream()
		const writer = control.writable.getWriter()
		const reader = new ExactStreamReader(control.readable)
		await writeJsonFrame(writer, { type: 'hello', version: NATIVE_AGENT_BRIDGE_VERSION, launchToken: callback.launchToken })
		const ack = await readJsonFrame(reader) as BridgeHelloAck
		if (ack.type !== 'hello-ack' || ack.version !== NATIVE_AGENT_BRIDGE_VERSION) throw new Error('本机加速组件版本不兼容')
		if (!ack.accepted) throw new Error(ack.error || '本机加速组件拒绝了启动凭据，请重新开启极速模式')
		const bridge = new LanNativeLocalBridge(transport, writer, reader, callback)
		void bridge.readLoop()
		return bridge
	}

	async issueTicket(ownerDeviceId: string): Promise<LanNativeAgentTicket> {
		const result = await this.request<{ token: string; expiresAt: number }>('issue-benchmark-ticket')
		if (!/^[0-9a-f]{32}$/i.test(result.token) || result.expiresAt <= Date.now()) throw new Error('本机组件返回了无效的测试凭据')
		return {
			bridgeVersion: NATIVE_AGENT_BRIDGE_VERSION,
			benchmarkVersion: NATIVE_AGENT_BENCHMARK_VERSION,
			ownerDeviceId,
			endpoints: this.callback.benchmarkEndpoints,
			lnaHttpVersion: NATIVE_AGENT_LNA_HTTP_VERSION,
			lnaHttpEndpoints: this.callback.lnaHttpEndpoints,
			fileVersion: NATIVE_AGENT_FILE_VERSION,
			fileHttpEndpoints: this.callback.fileHttpEndpoints,
			fileWebTransportEndpoints: this.callback.fileWebTransportEndpoints,
			certificateSha256: this.callback.certificateSha256,
			token: result.token,
			expiresAt: result.expiresAt,
		}
	}

	selectFiles() {
		return this.request<LanNativeSelectedFile[]>('select-files')
	}

	async createSendTransfer(options: { sourceId: string; attachmentId: string; ownerDeviceId: string; peerDeviceId: string; dataPlane: LanNativeFileDataPlane }) {
		const grant = await this.createSerializedTransfer(() => this.request<Omit<LanNativeTransferGrant, 'fileHttpEndpoints' | 'fileWebTransportEndpoints' | 'certificateSha256'>>('create-send-transfer', options))
		return this.decorateGrant(grant)
	}

	async prepareReceiveTransfer(options: { attachmentId: string; ownerDeviceId: string; peerDeviceId: string; name: string; totalBytes: number; dataPlane: LanNativeFileDataPlane }) {
		const grant = await this.createSerializedTransfer(() => this.request<Omit<LanNativeTransferGrant, 'fileHttpEndpoints' | 'fileWebTransportEndpoints' | 'certificateSha256'> | null>('prepare-receive-transfer', options))
		return grant ? this.decorateGrant(grant) : null
	}

	async cancelTransfer(transferId: string) {
		try {
			await this.request('cancel-transfer', { transferId })
		} finally {
			this.releaseTransfer(transferId)
		}
	}

	async finishSendTransfer(transferId: string) {
		try {
			await this.request('finish-send-transfer', { transferId })
		} finally {
			this.releaseTransfer(transferId)
		}
	}

	async releaseSource(sourceId: string) {
		await this.request('release-source', { sourceId })
	}

	subscribe(listener: (event: LanNativeTransferEvent) => void) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	close() {
		this.shutdown(new Error('本机加速组件连接已关闭'), 0, 'speed mode disabled')
	}

	private decorateGrant(grant: Omit<LanNativeTransferGrant, 'fileHttpEndpoints' | 'fileWebTransportEndpoints' | 'certificateSha256'>): LanNativeTransferGrant {
		return {
			...grant,
			fileHttpEndpoints: this.callback.fileHttpEndpoints,
			fileWebTransportEndpoints: this.callback.fileWebTransportEndpoints,
			certificateSha256: this.callback.certificateSha256,
		}
	}

	private request<T = unknown>(type: string, body: Record<string, unknown> = {}) {
		if (this.closed) return Promise.reject(new Error('本机加速组件连接已关闭'))
		const requestId = (this.requestId = (this.requestId + 1) >>> 0)
		const result = new Promise<T>((resolve, reject) => {
			this.pending.set(requestId, { resolve: value => resolve(value as T), reject })
		})
		this.writeQueue = this.writeQueue.then(() => writeJsonFrame(this.writer, { type, requestId, ...body }))
		this.writeQueue.catch(error => {
			const pending = this.pending.get(requestId)
			if (!pending) return
			this.pending.delete(requestId)
			pending.reject(error instanceof Error ? error : new Error('无法向本机组件发送命令'))
		})
		return result
	}

	private async createSerializedTransfer<T extends { transferId: string } | null>(create: () => Promise<T>) {
		const previous = this.transferQueue
		let release!: () => void
		this.transferQueue = new Promise<void>(resolve => { release = resolve })
		await previous
		try {
			const grant = await create()
			if (grant) this.transferReleases.set(grant.transferId, release)
			else release()
			return grant
		} catch (error) {
			release()
			throw error
		}
	}

	private releaseTransfer(transferId: string) {
		const release = this.transferReleases.get(transferId)
		if (!release) return
		this.transferReleases.delete(transferId)
		release()
	}

	private shutdown(error: Error, closeCode: number, reason: string) {
		if (this.closed) return
		this.closed = true
		this.pending.forEach(pending => pending.reject(error))
		this.pending.clear()
		this.listeners.clear()
		this.transferReleases.forEach(release => release())
		this.transferReleases.clear()
		void this.writer.close().catch(() => {})
		this.reader.release()
		this.transport.close({ closeCode, reason })
	}

	private async readLoop() {
		try {
			while (!this.closed) {
				const frame = await readJsonFrame(this.reader)
				if (isBridgeResponse(frame)) {
					const pending = this.pending.get(frame.requestId)
					if (!pending) continue
					this.pending.delete(frame.requestId)
					if (frame.ok) pending.resolve(frame.result)
					else pending.reject(new Error(frame.error || '本机组件命令执行失败'))
					continue
				}
				if (isTransferEvent(frame)) {
					if (frame.type === 'transfer-complete' || frame.type === 'transfer-failed' || frame.type === 'transfer-cancelled') this.releaseTransfer(frame.transferId)
					this.listeners.forEach(listener => listener(frame))
				}
			}
		} catch (error) {
			this.shutdown(error instanceof Error ? error : new Error('本机组件控制连接中断'), 1, 'bridge control failed')
		}
	}
}

async function writeJsonFrame(writer: WritableStreamDefaultWriter<Uint8Array>, value: unknown) {
	const body = encoder.encode(JSON.stringify(value))
	if (!body.byteLength || body.byteLength > MAX_BRIDGE_FRAME_BYTES) throw new Error('本机组件命令过大')
	const frame = new Uint8Array(body.byteLength + 4)
	new DataView(frame.buffer).setUint32(0, body.byteLength)
	frame.set(body, 4)
	await writer.write(frame)
}

async function readJsonFrame(reader: ExactStreamReader): Promise<unknown> {
	const prefix = await reader.readExact(4)
	const length = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0)
	if (!length || length > MAX_BRIDGE_FRAME_BYTES) throw new Error('本机组件返回了无效控制帧')
	return JSON.parse(decoder.decode(await reader.readExact(length)))
}

function isBridgeResponse(value: unknown): value is BridgeResponse {
	if (!value || typeof value !== 'object') return false
	const response = value as Partial<BridgeResponse>
	return response.type === 'response' && Number.isSafeInteger(response.requestId) && typeof response.ok === 'boolean'
}

function isTransferEvent(value: unknown): value is LanNativeTransferEvent {
	if (!value || typeof value !== 'object') return false
	const type = (value as { type?: unknown }).type
	return type === 'transfer-progress' || type === 'transfer-confirming' || type === 'transfer-complete' || type === 'transfer-failed' || type === 'transfer-cancelled'
}
