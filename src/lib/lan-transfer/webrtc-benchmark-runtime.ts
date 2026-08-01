import { encodeBenchmarkChunk } from './file-transfer'
import type { LanConnectionTransport } from './transport-types'
import {
	LAN_LIMITS,
	LAN_CHUNK_TIERS,
	type LanControlMessage,
	type LanWebRtcBenchmarkDirection,
	type LanWebRtcBenchmarkProgress,
	type LanWebRtcBenchmarkResult,
} from './types'

type ActiveBenchmark = {
	id: string
	role: 'sender' | 'receiver'
	state: 'waiting-ready' | 'running'
	localRequested: boolean
	direction: LanWebRtcBenchmarkDirection
	totalBytes: number
	chunkSize: number
	bytes: number
	nextIndex: number
	startedAt: number
	firstByteAt: number
	lastProgressAt: number
	controller: AbortController
	timer: ReturnType<typeof setTimeout>
	resolve?: (result: LanWebRtcBenchmarkResult) => void
	reject?: (error: Error) => void
	onProgress?: (progress: LanWebRtcBenchmarkProgress) => void
	removeExternalAbort?: () => void
}

type Callbacks = {
	transport: () => LanConnectionTransport | null
	recommendedChunkSize: () => number | undefined
	fileTransferActive: () => boolean
	mobile: () => boolean
	createId: () => string
	sendRequest: (message: { benchmarkId: string; direction: 'requester-to-peer' | 'peer-to-requester'; totalBytes: number; chunkSize: number }) => boolean
	sendReady: (message: { benchmarkId: string; accepted: boolean; error?: string }) => boolean
	sendResult: (message: { benchmarkId: string; receivedBytes: number; receiverElapsedMs: number }) => boolean
	sendCancel: (message: { benchmarkId: string; reason: string }) => boolean
}

const TIMEOUT_MS = 180_000
const MAX_BYTES = 2 * 1024 * 1024 * 1024
const ZERO_BYTES = new Uint8Array(LAN_LIMITS.dataChannelMaxChunkSize)

export class LanWebRtcBenchmarkRuntime {
	private active: ActiveBenchmark | null = null

	constructor(private readonly callbacks: Callbacks) {}

	isActive() {
		return Boolean(this.active)
	}

	reset(reason = '连接已断开，测速已停止') {
		this.finish(this.active, undefined, new Error(reason))
	}

	async run(direction: LanWebRtcBenchmarkDirection, totalBytes: number, onProgress?: (progress: LanWebRtcBenchmarkProgress) => void, signal?: AbortSignal) {
		const transport = this.callbacks.transport()
		if (!transport?.isOpen()) throw new Error('请先连接测速设备')
		if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > MAX_BYTES) throw new Error('WebRTC 测速大小无效')
		if (this.active || this.callbacks.fileTransferActive()) throw new Error('当前连接正在传输文件或测速，请稍后重试')
		throwIfAborted(signal)

		const chunkSize = await transport.negotiateChunkSize(this.callbacks.recommendedChunkSize())
		if (transport !== this.callbacks.transport() || !transport.isOpen()) throw new Error('连接已断开，请重新测速')
		if (this.active || this.callbacks.fileTransferActive()) throw new Error('当前连接已经开始其他传输，请稍后重试')
		throwIfAborted(signal)

		return new Promise<LanWebRtcBenchmarkResult>((resolve, reject) => {
			const active = this.create({
				id: this.callbacks.createId(),
				role: direction === 'upload' ? 'sender' : 'receiver',
				state: 'waiting-ready',
				localRequested: true,
				direction,
				totalBytes,
				chunkSize,
				resolve,
				reject,
				onProgress,
			})
			if (signal) {
				const abort = () => this.cancel('测速已取消', new DOMException('测速已取消', 'AbortError'))
				signal.addEventListener('abort', abort, { once: true })
				active.removeExternalAbort = () => signal.removeEventListener('abort', abort)
			}
			this.active = active
			const sent = this.callbacks.sendRequest({
				benchmarkId: active.id,
				direction: direction === 'upload' ? 'requester-to-peer' : 'peer-to-requester',
				totalBytes,
				chunkSize,
			})
			if (!sent) this.finish(active, undefined, new Error('无法向对方发起 WebRTC 测速'))
		})
	}

	handleFrame(id: string, index: number, bytes: Uint8Array) {
		const active = this.active
		if (!active || active.id !== id || active.role !== 'receiver' || active.state !== 'running') return
		const expectedBytes = Math.min(active.chunkSize, active.totalBytes - active.bytes)
		if (index !== active.nextIndex || bytes.byteLength !== expectedBytes || expectedBytes <= 0) return this.cancel('WebRTC 测速数据顺序或大小不一致')
		const now = performance.now()
		if (!active.firstByteAt) active.firstByteAt = now
		active.nextIndex += 1
		active.bytes += bytes.byteLength
		this.report(active, active.bytes === active.totalBytes)
		if (active.bytes !== active.totalBytes) return

		const receiverElapsedMs = Math.max(now - active.firstByteAt, 0.001)
		const sent = this.callbacks.sendResult({ benchmarkId: active.id, receivedBytes: active.bytes, receiverElapsedMs })
		if (!sent) return this.finish(active, undefined, new Error('测速完成，但无法向对方确认结果'))
		if (!active.localRequested) return this.finish(active)
		this.finish(active, this.result(active, receiverElapsedMs))
	}

	handleRequest(message: Extract<LanControlMessage, { type: 'webrtc-benchmark-request' }>) {
		const validId = typeof message.benchmarkId === 'string' && message.benchmarkId.length > 0 && message.benchmarkId.length <= 128
		const validSize = Number.isSafeInteger(message.totalBytes) && message.totalBytes > 0 && message.totalBytes <= MAX_BYTES
		const validChunk = LAN_CHUNK_TIERS.some(tier => tier.chunkSize === message.chunkSize)
		const validDirection = message.direction === 'requester-to-peer' || message.direction === 'peer-to-requester'
		const reject = (error: string) => this.callbacks.sendReady({ benchmarkId: typeof message.benchmarkId === 'string' ? message.benchmarkId : '', accepted: false, error })
		if (!validId || !validSize || !validChunk || !validDirection) return void reject('WebRTC 测速参数无效')
		if (!this.callbacks.transport()?.isOpen()) return void reject('当前连接不可用')
		if (this.active || this.callbacks.fileTransferActive()) return void reject('当前连接正在传输文件或测速')

		const role = message.direction === 'requester-to-peer' ? 'receiver' : 'sender'
		const active = this.create({
			id: message.benchmarkId,
			role,
			state: 'running',
			localRequested: false,
			direction: role === 'sender' ? 'upload' : 'download',
			totalBytes: message.totalBytes,
			chunkSize: message.chunkSize,
		})
		active.startedAt = performance.now()
		this.active = active
		if (!this.callbacks.sendReady({ benchmarkId: active.id, accepted: true })) return this.finish(active)
		if (active.role === 'sender') void this.pump(active)
	}

	handleReady(message: Extract<LanControlMessage, { type: 'webrtc-benchmark-ready' }>) {
		const active = this.active
		if (!active || active.id !== message.benchmarkId || !active.localRequested || active.state !== 'waiting-ready') return
		if (!message.accepted) return this.finish(active, undefined, new Error(message.error || '对方拒绝了 WebRTC 测速'))
		active.state = 'running'
		active.startedAt = performance.now()
		this.report(active, true)
		if (active.role === 'sender') void this.pump(active)
	}

	handleResult(message: Extract<LanControlMessage, { type: 'webrtc-benchmark-result' }>) {
		const active = this.active
		if (!active || active.id !== message.benchmarkId || active.role !== 'sender' || active.state !== 'running') return
		if (message.receivedBytes !== active.totalBytes || !Number.isFinite(message.receiverElapsedMs) || message.receiverElapsedMs <= 0) return this.cancel('WebRTC 测速结果不一致')
		if (!active.localRequested) return this.finish(active)
		this.finish(active, this.result(active, message.receiverElapsedMs))
	}

	handleCancel(message: Extract<LanControlMessage, { type: 'webrtc-benchmark-cancel' }>) {
		if (this.active?.id === message.benchmarkId) this.finish(this.active, undefined, new Error(message.reason || '对方取消了测速'))
	}

	private create(options: Pick<ActiveBenchmark, 'id' | 'role' | 'state' | 'localRequested' | 'direction' | 'totalBytes' | 'chunkSize' | 'resolve' | 'reject' | 'onProgress'>) {
		const active: ActiveBenchmark = {
			...options,
			bytes: 0,
			nextIndex: 0,
			startedAt: 0,
			firstByteAt: 0,
			lastProgressAt: 0,
			controller: new AbortController(),
			timer: setTimeout(() => {
				if (this.active === active) this.cancel('测速超时，请检查当前连接')
			}, TIMEOUT_MS),
		}
		return active
	}

	private report(active: ActiveBenchmark, force = false) {
		if (!active.localRequested || !active.onProgress || !active.startedAt) return
		const now = performance.now()
		if (!force && now - active.lastProgressAt < 100) return
		active.lastProgressAt = now
		active.onProgress({ direction: active.direction, bytes: active.bytes, totalBytes: active.totalBytes, startedAt: active.startedAt })
	}

	private async pump(active: ActiveBenchmark) {
		const transport = this.callbacks.transport()
		if (!transport) return this.finish(active, undefined, new Error('连接已断开，测速已停止'))
		const highWatermark = this.callbacks.mobile() ? LAN_LIMITS.mobileBufferHighWatermark : LAN_LIMITS.bufferHighWatermark
		const lowWatermark = this.callbacks.mobile() ? LAN_LIMITS.mobileBufferLowWatermark : LAN_LIMITS.bufferLowWatermark
		try {
			while (active.bytes < active.totalBytes) {
				if (this.active !== active || this.callbacks.transport() !== transport || !transport.isOpen()) throw new Error('连接已断开，测速已停止')
				await transport.waitUntilWritable(highWatermark, lowWatermark, LAN_LIMITS.bufferDrainTimeoutMs, active.controller.signal)
				const count = Math.min(active.chunkSize, active.totalBytes - active.bytes)
				if (!transport.send(encodeBenchmarkChunk(active.id, active.nextIndex, ZERO_BYTES.subarray(0, count)))) throw new Error('WebRTC 测速数据发送失败')
				active.nextIndex += 1
				active.bytes += count
				this.report(active, active.bytes === active.totalBytes)
			}
		} catch (error) {
			if (this.active !== active || active.controller.signal.aborted) return
			this.cancel(error instanceof Error ? error.message : 'WebRTC 测速失败', error instanceof Error ? error : undefined)
		}
	}

	private result(active: ActiveBenchmark, receiverElapsedMs: number): LanWebRtcBenchmarkResult {
		const clientElapsedMs = Math.max(performance.now() - active.startedAt, 0.001)
		return {
			direction: active.direction,
			bytes: active.totalBytes,
			clientElapsedMs,
			receiverElapsedMs,
			clientMbps: (active.totalBytes * 8) / clientElapsedMs / 1_000,
			receiverMbps: (active.totalBytes * 8) / receiverElapsedMs / 1_000,
		}
	}

	private cancel(reason: string, error = new Error(reason)) {
		if (!this.active) return
		this.callbacks.sendCancel({ benchmarkId: this.active.id, reason })
		this.finish(this.active, undefined, error)
	}

	private finish(active: ActiveBenchmark | null, result?: LanWebRtcBenchmarkResult, error?: Error) {
		if (!active || this.active !== active) return
		this.active = null
		clearTimeout(active.timer)
		active.removeExternalAbort?.()
		active.controller.abort()
		if (error) active.reject?.(error)
		else if (result) active.resolve?.(result)
	}
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException('测速已取消', 'AbortError')
}
