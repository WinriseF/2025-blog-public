import { decodeFrame, encodeChunk } from '@/lib/lan-transfer/file-transfer'
import type { LanStorageEngine, TransferFileMeta } from '@/lib/lan-transfer/storage/types'
import { createBenchmarkStorageEngine } from './storage'
import { appendBenchmarkSample, bytesToMiBps, type BenchmarkCategory, type BenchmarkResult, type BenchmarkRunConfig, type BenchmarkSample } from './types'
import type { BenchmarkPeer } from './peer'

const controlName = 'lan-benchmark-control-v1'

type BenchmarkControl =
	| { name: typeof controlName; type: 'prepare'; run: BenchmarkRunConfig }
	| { name: typeof controlName; type: 'ready'; id: string }
	| { name: typeof controlName; type: 'finish'; id: string; bytes: number; chunkCount: number }
	| { name: typeof controlName; type: 'result'; result: BenchmarkResult }
	| { name: typeof controlName; type: 'abort'; id: string; reason: string }

type ReceiveRun = {
	config: BenchmarkRunConfig
	engine: LanStorageEngine | null
	meta: TransferFileMeta | null
	bytes: number
	writeMs: number
	startedAt: number
	startedPerf: number
	samples: BenchmarkSample[]
	queue: Promise<void>
}

type SendRun = {
	config: BenchmarkRunConfig
	bytes: number
	startedAt: number
	startedPerf: number
	samples: BenchmarkSample[]
}

export type BenchmarkRunnerEvents = {
	onStatus: (status: string) => void
	onRunStart: (run: BenchmarkRunConfig) => void
	onProgress: (id: string, bytes: number, totalBytes: number, samples: BenchmarkSample[]) => void
	onResult: (result: BenchmarkResult) => void
	onDirectFileRequired: (run: BenchmarkRunConfig | null) => void
}

function isControl(value: unknown): value is BenchmarkControl {
	if (!value || typeof value !== 'object') return false
	const control = value as Partial<BenchmarkControl>
	return control.name === controlName && ['prepare', 'ready', 'finish', 'result', 'abort'].includes(control.type || '')
}

function makeChunk(seed: Uint8Array, index: number, size: number) {
	const bytes = seed.slice(0, size)
	new DataView(bytes.buffer).setUint32(0, index)
	return bytes
}

function makeSeed(size: number) {
	const bytes = new Uint8Array(size)
	for (let offset = 0; offset < bytes.byteLength; offset += 65_536) crypto.getRandomValues(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 65_536)))
	return bytes
}

function categoryFor(storage: BenchmarkRunConfig['storage']): BenchmarkCategory {
	return storage === 'sink' ? 'framed-rtc' : 'production-e2e'
}

export class BenchmarkRunner {
	private receiveRun: ReceiveRun | null = null
	private sendRun: SendRun | null = null
	private preparingRun: BenchmarkRunConfig | null = null
	private pendingDirectRun: BenchmarkRunConfig | null = null
	private waitTimer: number | null = null

	constructor(private readonly peer: BenchmarkPeer, private readonly events: BenchmarkRunnerEvents) {}

	handleControl(value: unknown) {
		if (!isControl(value)) return
		if (value.type === 'prepare') return void this.prepareReceive(value.run)
		if (value.type === 'ready') return void this.startSending(value.id)
		if (value.type === 'finish') return void this.finishReceive(value)
		if (value.type === 'result') return this.finishSend(value.result)
		if (value.type === 'abort') this.abort(value.id, value.reason)
	}

	handleData(data: unknown) {
		const frame = decodeFrame(data)
		if (!frame || frame.kind !== 'chunk') return
		const run = this.receiveRun
		if (!run || frame.id !== run.config.id) return
		if (run.config.storage === 'sink') {
			run.bytes += frame.bytes.byteLength
			if (appendBenchmarkSample(run.samples, run.startedPerf, run.bytes, undefined, run.bytes >= run.config.totalBytes)) this.events.onProgress(run.config.id, run.bytes, run.config.totalBytes, run.samples)
			return
		}
		if (!run.meta || !run.engine) return
		run.queue = run.queue.then(async () => {
			const started = performance.now()
			await run.engine?.writeChunk(run.meta as TransferFileMeta, frame.index, frame.bytes)
			run.writeMs += performance.now() - started
			run.bytes += frame.bytes.byteLength
			if (appendBenchmarkSample(run.samples, run.startedPerf, run.bytes, undefined, run.bytes >= run.config.totalBytes)) this.events.onProgress(run.config.id, run.bytes, run.config.totalBytes, run.samples)
		}).catch(error => this.abort(run.config.id, error instanceof Error ? error.message : '接收写入失败', true))
	}

	start(config: BenchmarkRunConfig) {
		if (!this.peer.isOpen()) throw new Error('请先让两台设备完成诊断连接')
		if (this.sendRun || this.receiveRun || this.pendingRuns.size) throw new Error('已有基准测试正在运行')
		this.pendingRuns.set(config.id, config)
		if (!this.peer.sendControl({ name: controlName, type: 'prepare', run: config } satisfies BenchmarkControl)) {
			this.pendingRuns.delete(config.id)
			throw new Error('无法发送测试准备请求')
		}
		this.waitFor(config.id, '接收端准备超时')
		this.events.onStatus('接收端正在准备测试环境')
	}

	async prepareDirectFile() {
		const run = this.pendingDirectRun
		if (!run) return
		this.pendingDirectRun = null
		this.events.onDirectFileRequired(null)
		await this.createReceiveRun(run)
	}

	cancel() {
		const id = this.sendRun?.config.id || this.receiveRun?.config.id || this.preparingRun?.id || this.pendingDirectRun?.id || this.pendingRuns.keys().next().value
		if (!id) return
		this.abort(id, '测试已取消', true)
	}

	private async prepareReceive(config: BenchmarkRunConfig) {
		if (this.receiveRun || this.preparingRun || this.pendingDirectRun) {
			this.peer.sendControl({ name: controlName, type: 'abort', id: config.id, reason: '接收端已有测试正在运行' } satisfies BenchmarkControl)
			return
		}
		if (config.storage === 'file') {
			this.pendingDirectRun = config
			this.events.onDirectFileRequired(config)
			this.events.onStatus('接收端需要选择 Direct File 测试文件')
			return
		}
		await this.createReceiveRun(config)
	}

	private async createReceiveRun(config: BenchmarkRunConfig) {
		const startedAt = Date.now()
		const startedPerf = performance.now()
		let engine: LanStorageEngine | null = null
		let meta: TransferFileMeta | null = null
		this.preparingRun = config
		this.events.onRunStart(config)
		try {
			const storage = config.storage
			const chunkCount = Math.ceil(config.totalBytes / config.chunkSize)
			if (storage !== 'sink') {
				engine = createBenchmarkStorageEngine(storage)
				meta = {
					id: config.id,
					name: `lan-benchmark-${Date.now()}.bin`,
					mime: 'application/octet-stream',
					size: config.totalBytes,
					lastModified: Date.now(),
					chunkSize: config.chunkSize,
					chunkCount,
					storage,
				}
				await engine.prepare(meta)
			}
			if (this.preparingRun?.id !== config.id) {
				if (engine && meta) await engine.cleanup(meta.id).catch(() => {})
				return
			}
			this.receiveRun = { config, engine, meta, bytes: 0, writeMs: 0, startedAt, startedPerf, samples: [], queue: Promise.resolve() }
			this.preparingRun = null
			if (!this.peer.sendControl({ name: controlName, type: 'ready', id: config.id } satisfies BenchmarkControl)) throw new Error('无法确认接收端就绪')
			this.events.onStatus(storage === 'sink' ? '接收端就绪：将只计数不写盘' : `接收端就绪：写入 ${storage}`)
		} catch (error) {
			const reason = error instanceof Error ? error.message : '无法准备接收测试'
			if (this.receiveRun?.config.id === config.id) this.abort(config.id, reason, true)
			else {
				if (engine && meta) void engine.cleanup(meta.id).catch(() => {})
				if (this.preparingRun?.id === config.id) this.failReceiveSetup(config, startedAt, startedPerf, reason)
			}
		}
	}

	private async startSending(id: string) {
		if (this.sendRun || !this.peer.isOpen()) return
		const config = this.pendingConfig(id)
		if (!config) return
		this.clearWaitTimer()
		const startedAt = Date.now()
		const startedPerf = performance.now()
		const run: SendRun = { config, bytes: 0, startedAt, startedPerf, samples: [] }
		this.sendRun = run
		this.events.onRunStart(config)
		this.events.onStatus(config.storage === 'sink' ? '正在进行 WebRTC Sink 极限测试' : `正在进行 WebRTC + ${config.storage} 端到端测试`)
		try {
			const seed = makeSeed(config.chunkSize)
			const chunkCount = Math.ceil(config.totalBytes / config.chunkSize)
			for (let index = 0; index < chunkCount; index += 1) {
				const size = Math.min(config.chunkSize, config.totalBytes - run.bytes)
				await this.peer.waitUntilWritable(config.highWatermark, config.lowWatermark, 60_000)
				const frame = encodeChunk(config.id, index, makeChunk(seed, index, size))
				if (!this.peer.send(frame)) throw new Error('DataChannel 写入失败')
				run.bytes += size
				if (appendBenchmarkSample(run.samples, run.startedPerf, run.bytes, this.peer.bufferedAmount, run.bytes >= config.totalBytes)) this.events.onProgress(config.id, run.bytes, config.totalBytes, run.samples)
			}
			if (!this.peer.sendControl({ name: controlName, type: 'finish', id: config.id, bytes: run.bytes, chunkCount } satisfies BenchmarkControl)) throw new Error('无法发送完成确认')
			this.waitFor(config.id, '接收端结果确认超时')
			this.events.onStatus('发送已排入 DataChannel，等待接收端落盘与确认')
		} catch (error) {
			this.abort(id, error instanceof Error ? error.message : '发送测试失败', true)
		}
	}

	private pendingConfig(id: string) {
		const candidate = this.pendingRuns.get(id)
		this.pendingRuns.delete(id)
		return candidate || null
	}

	private pendingRuns = new Map<string, BenchmarkRunConfig>()

	private async finishReceive(control: Extract<BenchmarkControl, { type: 'finish' }>) {
		const run = this.receiveRun
		if (!run || run.config.id !== control.id) return
		try {
			await run.queue
			if (run.bytes !== control.bytes || run.bytes !== run.config.totalBytes) throw new Error(`接收字节不一致：${run.bytes} / ${run.config.totalBytes}`)
			let checkpointMs = 0
			let finalizeMs = 0
			if (run.engine && run.meta) {
				const checkpointStarted = performance.now()
				await run.engine.checkpoint(run.meta)
				checkpointMs = performance.now() - checkpointStarted
				const finalizeStarted = performance.now()
				const finalized = await run.engine.finalize(run.meta)
				finalizeMs = performance.now() - finalizeStarted
				finalized.revoke?.()
			}
			const endedPerf = performance.now()
			const result: BenchmarkResult = {
				id: run.config.id,
				label: run.config.label,
				category: categoryFor(run.config.storage),
				scope: 'peer-receive',
				storage: run.config.storage,
				totalBytes: run.config.totalBytes,
				chunkSize: run.config.chunkSize,
				bytes: run.bytes,
				throughputMiBps: bytesToMiBps(run.bytes, run.writeMs || endedPerf - run.startedPerf),
				startedAt: run.startedAt,
				finishedAt: Date.now(),
				timings: { writeMs: run.writeMs, checkpointMs, finalizeMs, endToEndMs: endedPerf - run.startedPerf },
				samples: run.samples,
				status: 'complete',
			}
			this.events.onResult(result)
			this.peer.sendControl({ name: controlName, type: 'result', result } satisfies BenchmarkControl)
			this.events.onStatus('接收端已完成并确认结果')
		} catch (error) {
			this.abort(control.id, error instanceof Error ? error.message : '接收结果校验失败', true)
		} finally {
			const current = this.receiveRun
			this.receiveRun = null
			if (current?.engine && current.meta) await current.engine.cleanup(current.meta.id).catch(() => {})
		}
	}

	private async finishSend(remoteResult: BenchmarkResult) {
		const run = this.sendRun
		if (!run || run.config.id !== remoteResult.id) return
		const stats = await this.peer.getStats().catch(() => null)
		const endedPerf = performance.now()
		const result: BenchmarkResult = {
			id: run.config.id,
			label: run.config.label,
			category: categoryFor(run.config.storage),
			scope: 'peer-send',
			storage: run.config.storage,
			totalBytes: run.config.totalBytes,
			chunkSize: run.config.chunkSize,
			bytes: run.bytes,
			throughputMiBps: bytesToMiBps(run.bytes, endedPerf - run.startedPerf),
			startedAt: run.startedAt,
			finishedAt: Date.now(),
			timings: { sendMs: run.samples.at(-1)?.elapsedMs, endToEndMs: endedPerf - run.startedPerf },
			samples: run.samples,
			route: stats?.route,
			status: 'complete',
		}
		this.events.onResult(remoteResult)
		this.events.onResult(result)
		this.events.onStatus('双端基准测试完成')
		this.sendRun = null
		this.clearWaitTimer()
	}

	private failReceiveSetup(config: BenchmarkRunConfig, startedAt: number, startedPerf: number, reason: string) {
		this.preparingRun = this.preparingRun?.id === config.id ? null : this.preparingRun
		this.pendingDirectRun = this.pendingDirectRun?.id === config.id ? null : this.pendingDirectRun
		this.events.onDirectFileRequired(null)
		this.events.onResult({
			id: config.id,
			label: config.label,
			category: categoryFor(config.storage),
			scope: 'peer-receive',
			storage: config.storage,
			totalBytes: config.totalBytes,
			chunkSize: config.chunkSize,
			bytes: 0,
			throughputMiBps: 0,
			startedAt,
			finishedAt: Date.now(),
			timings: { endToEndMs: performance.now() - startedPerf },
			samples: [],
			status: 'failed',
			error: reason,
		})
		this.events.onStatus(reason)
		this.peer.sendControl({ name: controlName, type: 'abort', id: config.id, reason } satisfies BenchmarkControl)
	}

	private abort(id: string, reason: string, notifyRemote = false) {
		const receive = this.receiveRun
		const send = this.sendRun
		const active = receive?.config.id === id ? receive : send?.config.id === id ? send : null
		const pending = this.pendingRuns.get(id)
		const preparing = this.preparingRun?.id === id ? this.preparingRun : null
		const direct = this.pendingDirectRun?.id === id ? this.pendingDirectRun : null
		const config = active?.config || preparing || direct || pending
		if (!config) return
		const endedPerf = performance.now()
		const result: BenchmarkResult = {
			id,
			label: config.label,
			category: categoryFor(config.storage),
			scope: receive?.config.id === id || preparing || direct ? 'peer-receive' : 'peer-send',
			storage: config.storage,
			totalBytes: config.totalBytes,
			chunkSize: config.chunkSize,
			bytes: active?.bytes || 0,
			throughputMiBps: active ? bytesToMiBps(active.bytes, endedPerf - active.startedPerf) : 0,
			startedAt: active?.startedAt || Date.now(),
			finishedAt: Date.now(),
			timings: { endToEndMs: active ? endedPerf - active.startedPerf : 0 },
			samples: active?.samples || [],
			status: reason === '测试已取消' ? 'cancelled' : 'failed',
			error: reason,
		}
		this.events.onResult(result)
		this.events.onStatus(reason)
		this.clearWaitTimer()
		this.pendingRuns.delete(id)
		this.receiveRun = null
		this.sendRun = null
		this.preparingRun = null
		this.pendingDirectRun = null
		this.events.onDirectFileRequired(null)
		if (receive?.config.id === id && receive.engine && receive.meta) void this.cleanupReceive(receive)
		if (notifyRemote) this.peer.sendControl({ name: controlName, type: 'abort', id, reason } satisfies BenchmarkControl)
	}

	private async cleanupReceive(run: ReceiveRun) {
		await run.queue.catch(() => {})
		if (run.engine && run.meta) await run.engine.cleanup(run.meta.id).catch(() => {})
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
