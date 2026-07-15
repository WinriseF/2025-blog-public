import { bytesToMiBps, type BenchmarkResult, type RawRtcFailureDetails, type RawRtcRunConfig, type RawRtcStatsSnapshot } from './types'
import { RawRtcSendError, type BenchmarkPeer } from './peer'

const controlName = 'lan-raw-rtc-control-v1'

type RawControl =
	| { name: typeof controlName; type: 'prepare'; run: RawRtcRunConfig }
	| { name: typeof controlName; type: 'ready'; id: string }
	| { name: typeof controlName; type: 'begin'; id: string }
	| { name: typeof controlName; type: 'started'; id: string }
	| { name: typeof controlName; type: 'result'; result: BenchmarkResult }
	| { name: typeof controlName; type: 'abort'; id: string; reason: string; failure?: RawRtcFailureDetails }

type RawReceiveRun = {
	config: RawRtcRunConfig
	phase: 'prepared' | 'warmup' | 'measuring' | 'complete'
	bytes: number
	warmupBytes: number
	startedAt: number
	startedPerf: number
	measurementStartedPerf: number
	startStats: Promise<RawRtcStatsSnapshot> | null
	warmupTimer: number | null
	finishTimer: number | null
}

type RawSendRun = {
	config: RawRtcRunConfig
	payload: Uint8Array
	bytes: number
	warmupBytes: number
	startedAt: number
	startedPerf: number
	phase: RawRtcFailureDetails['phase']
	measuring: boolean
	measurementTimer: number | null
	startStats: RawRtcStatsSnapshot | null
	endStats: RawRtcStatsSnapshot | null
	maxBufferedAmount: number
	backpressureWaitMs: number
	backpressureCount: number
	adaptiveBackpressureCount: number
	effectiveHighWatermark: number
	effectiveLowWatermark: number
	finishedSending: boolean
	receiverResult: BenchmarkResult | null
}

export type RawRtcRunnerEvents = {
	onStatus: (status: string) => void
	onRunStart: (run: RawRtcRunConfig) => void
	onResult: (result: BenchmarkResult) => void
}

function isControl(value: unknown): value is RawControl {
	if (!value || typeof value !== 'object') return false
	const control = value as Partial<RawControl>
	return control.name === controlName && ['prepare', 'ready', 'begin', 'started', 'result', 'abort'].includes(control.type || '')
}

function emptyStats(): RawRtcStatsSnapshot {
	return { capturedAt: performance.now(), dataChannelBytesSent: 0, dataChannelBytesReceived: 0, transportBytesSent: 0, transportBytesReceived: 0 }
}

function messageSizeLabel(bytes: number) {
	return `${bytes / 1024} KiB`
}

export class RawRtcRunner {
	private pendingRuns = new Map<string, RawRtcRunConfig>()
	private receiveRun: RawReceiveRun | null = null
	private sendRun: RawSendRun | null = null
	private waitTimer: number | null = null

	constructor(private readonly peer: BenchmarkPeer, private readonly events: RawRtcRunnerEvents) {}

	handleControl(value: unknown) {
		if (!isControl(value)) return
		if (value.type === 'prepare') return this.prepareReceive(value.run)
		if (value.type === 'ready') return this.beginReceive(value.id)
		if (value.type === 'begin') return this.startReceive(value.id)
		if (value.type === 'started') return void this.startSending(value.id)
		if (value.type === 'result') return this.finishSend(value.result)
		this.abort(value.id, value.reason, false, value.failure)
	}

	handleRawData(byteLength: number) {
		const run = this.receiveRun
		if (run?.phase === 'warmup') run.warmupBytes += byteLength
		else if (run?.phase === 'measuring') run.bytes += byteLength
	}

	start(config: RawRtcRunConfig) {
		if (!this.peer.isRawOpen()) throw new Error('请先让 Raw RTC DataChannel 就绪')
		const limit = this.peer.rawMessageSizeLimit()
		if (limit === null) throw new Error('浏览器尚未给出 SCTP 最大消息长度')
		if (config.messageSize > limit) throw new Error(`消息大小超过当前 SCTP 上限：${Math.floor(limit / 1024)} KiB`)
		if (this.sendRun || this.receiveRun || this.pendingRuns.size) throw new Error('已有基准测试正在运行')
		this.pendingRuns.set(config.id, config)
		if (!this.peer.sendControl({ name: controlName, type: 'prepare', run: config } satisfies RawControl)) {
			this.pendingRuns.delete(config.id)
			throw new Error('无法发送 Raw RTC 准备请求')
		}
		this.waitFor(config.id, 'Raw RTC 接收端准备超时')
		this.events.onStatus('Raw RTC 接收端正在就绪')
	}

	cancel() {
		const id = this.sendRun?.config.id || this.receiveRun?.config.id || this.pendingRuns.keys().next().value
		if (id) this.abort(id, '测试已取消', true)
	}

	private prepareReceive(config: RawRtcRunConfig) {
		if (this.receiveRun || this.sendRun || this.pendingRuns.size) {
			this.peer.sendControl({ name: controlName, type: 'abort', id: config.id, reason: '另一端已有 Raw RTC 测试正在运行' } satisfies RawControl)
			return
		}
		const limit = this.peer.rawMessageSizeLimit()
		if (limit === null || config.messageSize > limit) {
			this.peer.sendControl({ name: controlName, type: 'abort', id: config.id, reason: '接收端 SCTP 消息大小不可用' } satisfies RawControl)
			return
		}
		this.receiveRun = { config, phase: 'prepared', bytes: 0, warmupBytes: 0, startedAt: Date.now(), startedPerf: performance.now(), measurementStartedPerf: 0, startStats: null, warmupTimer: null, finishTimer: null }
		this.events.onStatus('Raw RTC 接收端已就绪')
		this.peer.sendControl({ name: controlName, type: 'ready', id: config.id } satisfies RawControl)
	}

	private beginReceive(id: string) {
		const config = this.pendingRuns.get(id)
		if (!config) return
		if (!this.peer.sendControl({ name: controlName, type: 'begin', id } satisfies RawControl)) return this.abort(id, '无法启动 Raw RTC 接收端', false)
		this.waitFor(id, 'Raw RTC 接收端启动超时')
	}

	private startReceive(id: string) {
		const run = this.receiveRun
		if (!run || run.config.id !== id || run.phase !== 'prepared') return
		run.phase = 'warmup'
		run.startedAt = Date.now()
		run.startedPerf = performance.now()
		this.events.onRunStart(run.config)
		run.warmupTimer = window.setTimeout(() => {
			if (this.receiveRun !== run || run.phase !== 'warmup') return
			run.phase = 'measuring'
			run.bytes = 0
			run.measurementStartedPerf = performance.now()
			run.startStats = this.peer.getRawStats().catch(() => emptyStats())
			run.finishTimer = window.setTimeout(() => void this.finishReceive(run), run.config.testMs)
		}, run.config.warmupMs)
		if (!this.peer.sendControl({ name: controlName, type: 'started', id } satisfies RawControl)) this.abort(id, '无法确认 Raw RTC 已启动', true)
		else this.events.onStatus(`Raw RTC 预热 ${run.config.warmupMs / 1_000} 秒`)
	}

	private async startSending(id: string) {
		const config = this.pendingRuns.get(id)
		if (!config || !this.peer.isRawOpen()) return
		const limit = this.peer.rawMessageSizeLimit()
		if (limit === null || config.messageSize > limit) return this.abort(id, '当前 SCTP 消息大小不可用', true)
		this.pendingRuns.delete(id)
		this.clearWaitTimer()
		const run: RawSendRun = {
			config,
			payload: new Uint8Array(config.messageSize),
			bytes: 0,
			warmupBytes: 0,
			startedAt: Date.now(),
			startedPerf: performance.now(),
			phase: 'warmup',
			measuring: false,
			measurementTimer: null,
			startStats: null,
			endStats: null,
			maxBufferedAmount: 0,
			backpressureWaitMs: 0,
			backpressureCount: 0,
			adaptiveBackpressureCount: 0,
			effectiveHighWatermark: config.highWatermark,
			effectiveLowWatermark: config.lowWatermark,
			finishedSending: false,
			receiverResult: null,
		}
		this.sendRun = run
		run.measurementTimer = window.setTimeout(() => {
			if (this.sendRun !== run) return
			run.phase = 'measuring'
			run.measuring = true
			run.bytes = 0
			void this.peer.getRawStats().then(stats => {
				if (this.sendRun === run) run.startStats = stats
			}).catch(() => {
				if (this.sendRun === run) run.startStats = emptyStats()
			})
		}, config.warmupMs)
		this.events.onRunStart(config)
		this.waitFor(id, 'Raw RTC 接收端结果超时')
		this.events.onStatus(`Raw RTC 预热 ${config.warmupMs / 1_000} 秒，随后测量 ${config.testMs / 1_000} 秒`)
		void this.pumpSend(run)
	}

	private async pumpSend(run: RawSendRun) {
		const deadline = run.startedPerf + run.config.warmupMs + run.config.testMs
		try {
			while (this.sendRun === run && performance.now() < deadline) {
				run.maxBufferedAmount = Math.max(run.maxBufferedAmount, this.peer.rawBufferedAmount)
				const waitedMs = await this.peer.waitUntilRawWritable(run.effectiveHighWatermark, run.effectiveLowWatermark, 60_000)
				if (waitedMs > 0) {
					run.backpressureCount += 1
					run.backpressureWaitMs += waitedMs
				}
				if (this.sendRun !== run || performance.now() >= deadline) break
				try {
					this.peer.sendRaw(run.payload)
				} catch (error) {
					if (await this.recoverQueueLimit(run, error)) continue
					throw error
				}
				if (run.measuring) run.bytes += run.payload.byteLength
				else run.warmupBytes += run.payload.byteLength
				run.maxBufferedAmount = Math.max(run.maxBufferedAmount, this.peer.rawBufferedAmount)
			}
			run.phase = 'finishing'
			run.endStats = await this.peer.getRawStats().catch(() => emptyStats())
			run.finishedSending = true
			this.finishSenderIfReady(run)
		} catch (error) {
			const failure = this.createSendFailure(run, error)
			const reason = failure.exceptionName ? `${failure.exceptionName}: ${failure.exceptionMessage || 'Raw RTC 发送失败'}` : 'Raw RTC 测试失败'
			this.abort(run.config.id, reason, true, failure)
		}
	}

	private async recoverQueueLimit(run: RawSendRun, error: unknown) {
		if (!(error instanceof RawRtcSendError) || error.details.name !== 'OperationError' || !this.peer.isRawOpen()) return false
		const observed = Math.max(error.details.bufferedAmount, this.peer.rawBufferedAmount)
		run.maxBufferedAmount = Math.max(run.maxBufferedAmount, observed)
		if (observed <= run.config.messageSize) return false
		const nextHigh = Math.max(run.config.messageSize, Math.floor(Math.min(run.effectiveHighWatermark, observed) * 0.75))
		if (nextHigh >= observed) return false
		run.effectiveHighWatermark = nextHigh
		run.effectiveLowWatermark = Math.min(run.config.lowWatermark, Math.floor(nextHigh / 4))
		run.adaptiveBackpressureCount += 1
		this.events.onStatus(`浏览器发送队列约 ${messageSizeLabel(observed)}，Raw 水位已调整为 ${messageSizeLabel(nextHigh)} / ${messageSizeLabel(run.effectiveLowWatermark)}`)
		const waitedMs = await this.peer.waitUntilRawWritable(nextHigh, run.effectiveLowWatermark, 60_000)
		if (waitedMs > 0) {
			run.backpressureCount += 1
			run.backpressureWaitMs += waitedMs
		}
		return true
	}

	private createSendFailure(run: RawSendRun, error: unknown): RawRtcFailureDetails {
		const details = error instanceof RawRtcSendError ? error.details : null
		const source = error instanceof Error ? error : null
		return {
			phase: run.phase,
			elapsedMs: performance.now() - run.startedPerf,
			warmupBytes: run.warmupBytes,
			measurementBytes: run.bytes,
			exceptionName: details?.name || source?.name,
			exceptionMessage: details?.message || source?.message || String(error),
			readyState: details?.readyState,
			connectionState: details?.connectionState,
			iceConnectionState: details?.iceConnectionState,
			bufferedAmount: details?.bufferedAmount ?? this.peer.rawBufferedAmount,
			maxMessageSize: details?.maxMessageSize,
			configuredHighWatermark: run.config.highWatermark,
			configuredLowWatermark: run.config.lowWatermark,
			effectiveHighWatermark: run.effectiveHighWatermark,
			effectiveLowWatermark: run.effectiveLowWatermark,
			backpressureCount: run.backpressureCount,
			adaptiveBackpressureCount: run.adaptiveBackpressureCount,
		}
	}

	private async finishReceive(run: RawReceiveRun) {
		if (this.receiveRun !== run || run.phase !== 'measuring') return
		run.phase = 'complete'
		const endedPerf = performance.now()
		const [startStats, endStats, routeStats] = await Promise.all([
			run.startStats || this.peer.getRawStats().catch(() => emptyStats()),
			this.peer.getRawStats().catch(() => emptyStats()),
			this.peer.getStats().catch(() => null),
		])
		const receiverElapsedMs = endedPerf - run.measurementStartedPerf
		const result: BenchmarkResult = {
			id: run.config.id,
			label: `Raw RTC · ${messageSizeLabel(run.config.messageSize)}`,
			category: 'raw-rtc',
			scope: 'peer-receive',
			storage: 'sink',
			totalBytes: run.bytes,
			chunkSize: run.config.messageSize,
			bytes: run.bytes,
			throughputMiBps: bytesToMiBps(run.bytes, receiverElapsedMs),
			startedAt: run.startedAt,
			finishedAt: Date.now(),
			timings: { endToEndMs: run.config.warmupMs + receiverElapsedMs },
			samples: [],
			route: routeStats?.route,
			raw: { messageSize: run.config.messageSize, warmupMs: run.config.warmupMs, testMs: run.config.testMs, warmupBytes: run.warmupBytes, receiverElapsedMs, startStats, endStats, configuredHighWatermark: run.config.highWatermark, configuredLowWatermark: run.config.lowWatermark, maxBufferedAmount: 0, backpressureWaitMs: 0, backpressureCount: 0, adaptiveBackpressureCount: 0 },
			status: 'complete',
		}
		this.events.onResult(result)
		this.peer.sendControl({ name: controlName, type: 'result', result } satisfies RawControl)
		this.events.onStatus('Raw RTC 接收端测量完成')
		this.clearReceiveRun(run)
	}

	private finishSend(receiverResult: BenchmarkResult) {
		const run = this.sendRun
		if (!run || run.config.id !== receiverResult.id) return
		run.receiverResult = receiverResult
		this.finishSenderIfReady(run)
	}

	private finishSenderIfReady(run: RawSendRun) {
		if (this.sendRun !== run || !run.finishedSending || !run.receiverResult || !run.endStats) return
		const senderElapsedMs = performance.now() - run.startedPerf
		const result: BenchmarkResult = {
			id: run.config.id,
			label: `Raw RTC · ${messageSizeLabel(run.config.messageSize)}`,
			category: 'raw-rtc',
			scope: 'peer-send',
			storage: 'sink',
			totalBytes: run.bytes,
			chunkSize: run.config.messageSize,
			bytes: run.bytes,
			throughputMiBps: bytesToMiBps(run.bytes, run.receiverResult.raw?.receiverElapsedMs || senderElapsedMs),
			startedAt: run.startedAt,
			finishedAt: Date.now(),
			timings: { sendMs: senderElapsedMs, endToEndMs: senderElapsedMs },
			samples: [],
			raw: { messageSize: run.config.messageSize, warmupMs: run.config.warmupMs, testMs: run.config.testMs, warmupBytes: run.warmupBytes, receiverElapsedMs: run.receiverResult.raw?.receiverElapsedMs || 0, startStats: run.startStats || emptyStats(), endStats: run.endStats, configuredHighWatermark: run.config.highWatermark, configuredLowWatermark: run.config.lowWatermark, effectiveHighWatermark: run.effectiveHighWatermark, effectiveLowWatermark: run.effectiveLowWatermark, maxBufferedAmount: run.maxBufferedAmount, backpressureWaitMs: run.backpressureWaitMs, backpressureCount: run.backpressureCount, adaptiveBackpressureCount: run.adaptiveBackpressureCount },
			status: 'complete',
		}
		this.events.onResult(run.receiverResult)
		this.events.onResult(result)
		this.events.onStatus('Raw RTC 双端测试完成')
		if (run.measurementTimer !== null) window.clearTimeout(run.measurementTimer)
		this.sendRun = null
		this.clearWaitTimer()
	}

	private abort(id: string, reason: string, notifyRemote = false, failure?: RawRtcFailureDetails) {
		const receive = this.receiveRun?.config.id === id ? this.receiveRun : null
		const send = this.sendRun?.config.id === id ? this.sendRun : null
		const pending = this.pendingRuns.get(id)
		const config = receive?.config || send?.config || pending
		if (!config) return
		const bytes = receive?.bytes || send?.bytes || 0
		const elapsedMs = send ? performance.now() - send.startedPerf : receive ? performance.now() - receive.startedPerf : 0
		const receivePhase = receive?.phase === 'measuring' ? 'measuring' : receive?.phase === 'warmup' ? 'warmup' : 'preparing'
		const rawFailure = reason === '测试已取消' ? undefined : failure || {
			phase: send?.phase || receivePhase,
			elapsedMs,
			warmupBytes: send?.warmupBytes || receive?.warmupBytes || 0,
			measurementBytes: bytes,
			configuredHighWatermark: config.highWatermark,
			configuredLowWatermark: config.lowWatermark,
			effectiveHighWatermark: send?.effectiveHighWatermark,
			effectiveLowWatermark: send?.effectiveLowWatermark,
			backpressureCount: send?.backpressureCount || 0,
			adaptiveBackpressureCount: send?.adaptiveBackpressureCount || 0,
		} satisfies RawRtcFailureDetails
		this.events.onResult({
			id,
			label: `Raw RTC · ${messageSizeLabel(config.messageSize)}`,
			category: 'raw-rtc',
			scope: receive ? 'peer-receive' : 'peer-send',
			storage: 'sink',
			totalBytes: bytes,
			chunkSize: config.messageSize,
			bytes,
			throughputMiBps: 0,
			startedAt: send?.startedAt || receive?.startedAt || Date.now(),
			finishedAt: Date.now(),
			timings: { endToEndMs: elapsedMs },
			samples: [],
			status: reason === '测试已取消' ? 'cancelled' : 'failed',
			error: reason,
			rawFailure,
		})
		this.events.onStatus(reason)
		this.pendingRuns.delete(id)
		if (receive) this.clearReceiveRun(receive)
		if (send) {
			if (send.measurementTimer !== null) window.clearTimeout(send.measurementTimer)
			this.sendRun = null
		}
		this.clearWaitTimer()
		if (notifyRemote) this.peer.sendControl({ name: controlName, type: 'abort', id, reason, failure: rawFailure } satisfies RawControl)
	}

	private clearReceiveRun(run: RawReceiveRun) {
		if (run.warmupTimer !== null) window.clearTimeout(run.warmupTimer)
		if (run.finishTimer !== null) window.clearTimeout(run.finishTimer)
		if (this.receiveRun === run) this.receiveRun = null
	}

	private waitFor(id: string, reason: string) {
		this.clearWaitTimer()
		this.waitTimer = window.setTimeout(() => this.abort(id, reason, true), 60_000)
	}

	private clearWaitTimer() {
		if (this.waitTimer === null) return
		window.clearTimeout(this.waitTimer)
		this.waitTimer = null
	}
}
