import { LAN_LIMITS } from './types'
import { hasChunk } from './storage/ranges'
import type { LanStorageEngine, TransferFileMeta, TransferManifest } from './storage/types'

const DIRECT_BATCH_BYTES = 4 * 1024 * 1024
const BATCH_DELAY_MS = 12

export type IncomingWriterSnapshot = {
	committedBytes: number
	committedChunks: number
	committedRanges: Array<[number, number]>
	receiveWindowBytes: number
	queuedBytes: number
	diskCommitBps: number
	pausedReason?: string
}

type WriterCallbacks = {
	onUpdate: (snapshot: IncomingWriterSnapshot, force: boolean) => void
	onFailure: (reason: string) => void
}

function firstMissing(manifest: TransferManifest) {
	let index = 0
	for (const [start, end] of manifest.receivedRanges) {
		if (index < start) break
		if (index <= end) index = end + 1
	}
	return index
}

export class IncomingAttachmentWriter {
	private pending = new Map<number, Uint8Array>()
	private pendingBytes = 0
	private inFlight = new Set<number>()
	private inFlightBytes = 0
	private nextIndex: number
	private writeTask: Promise<void> | null = null
	private batchTimer: ReturnType<typeof setTimeout> | null = null
	private stallTimer: ReturnType<typeof setInterval>
	private lastCommitAt = Date.now()
	private speedSampleAt = Date.now()
	private speedSampleBytes: number
	private diskCommitBps = 0
	private queuePaused = false
	private diskPaused = false
	private closed = false
	private cleanupStarted = false
	private completeWaiters = new Set<(manifest: TransferManifest | null) => void>()

	constructor(
		readonly engine: LanStorageEngine,
		readonly meta: TransferFileMeta,
		private manifest: TransferManifest,
		private readonly maxWindowBytes: number,
		private readonly callbacks: WriterCallbacks,
	) {
		this.nextIndex = firstMissing(manifest)
		this.speedSampleBytes = manifest.receivedBytes
		this.stallTimer = setInterval(() => this.checkStall(), 1000)
	}

	enqueue(chunkIndex: number, data: Uint8Array) {
		if (this.closed || chunkIndex < 0 || chunkIndex >= this.meta.chunkCount) return false
		if (hasChunk(this.manifest.receivedRanges, chunkIndex) || this.pending.has(chunkIndex) || this.inFlight.has(chunkIndex)) return true
		const wasIdle = !this.hasWork()
		if (this.queuedBytes() + data.byteLength > this.maxWindowBytes) {
			this.queuePaused = true
			this.callbacks.onUpdate(this.snapshot(), true)
			return false
		}
		this.pending.set(chunkIndex, data)
		this.pendingBytes += data.byteLength
		if (wasIdle) this.lastCommitAt = Date.now()
		this.callbacks.onUpdate(this.snapshot(), this.receiveWindowBytes() < this.meta.chunkSize)
		this.scheduleDrain()
		return true
	}

	snapshot(): IncomingWriterSnapshot {
		return {
			committedBytes: this.manifest.receivedBytes,
			committedChunks: this.manifest.receivedChunks,
			committedRanges: this.manifest.receivedRanges.map(range => [...range] as [number, number]),
			receiveWindowBytes: this.receiveWindowBytes(),
			queuedBytes: this.queuedBytes(),
			diskCommitBps: this.diskCommitBps,
			pausedReason: this.pausedReason(),
		}
	}

	discardPending() {
		this.pending.clear()
		this.pendingBytes = 0
		this.queuePaused = false
		if (this.batchTimer) clearTimeout(this.batchTimer)
		this.batchTimer = null
		this.callbacks.onUpdate(this.snapshot(), true)
	}

	waitForComplete(timeoutMs = LAN_LIMITS.diskStallAbortMs) {
		if (this.isComplete()) return Promise.resolve(this.manifest)
		if (this.closed) return Promise.resolve(null)
		return new Promise<TransferManifest | null>(resolve => {
			const finish = (manifest: TransferManifest | null) => {
				clearTimeout(timer)
				this.completeWaiters.delete(finish)
				resolve(manifest)
			}
			const timer = setTimeout(() => finish(null), timeoutMs)
			this.completeWaiters.add(finish)
		})
	}

	async finalize() {
		if (!this.isComplete()) throw new Error('接收不完整，请重新发送')
		const result = await this.engine.finalize(this.meta)
		this.closeTimers()
		return result
	}

	async destroy(cleanup = true) {
		if (!this.closed) {
			this.closed = true
			this.closeTimers()
			this.pending.clear()
			this.pendingBytes = 0
			this.resolveComplete(null)
		}
		if (cleanup && !this.cleanupStarted) {
			this.cleanupStarted = true
			await this.engine.cleanup(this.meta.id).catch(() => {})
		}
	}

	private scheduleDrain() {
		if (this.closed || this.writeTask || this.batchTimer || !this.pending.has(this.nextIndex)) return
		this.batchTimer = setTimeout(() => {
			this.batchTimer = null
			this.startDrain()
		}, BATCH_DELAY_MS)
	}

	private startDrain() {
		if (this.closed || this.writeTask) return
		const batch: Array<{ chunkIndex: number; data: Uint8Array }> = []
		let bytes = 0
		while (bytes < DIRECT_BATCH_BYTES) {
			const data = this.pending.get(this.nextIndex + batch.length)
			if (!data) break
			batch.push({ chunkIndex: this.nextIndex + batch.length, data })
			bytes += data.byteLength
		}
		if (!batch.length) return
		for (const item of batch) {
			this.pending.delete(item.chunkIndex)
			this.pendingBytes -= item.data.byteLength
			this.inFlight.add(item.chunkIndex)
		}
		this.inFlightBytes = bytes
		this.writeTask = this.writeBatch(batch).catch(error => {
			this.fail(error instanceof Error ? error.message : '文件写入失败')
		}).finally(() => {
			this.inFlight.clear()
			this.inFlightBytes = 0
			this.writeTask = null
			if (!this.closed) this.scheduleDrain()
		})
	}

	private async writeBatch(batch: Array<{ chunkIndex: number; data: Uint8Array }>) {
		let manifest = this.manifest
		if (this.engine.writeChunks) manifest = await this.engine.writeChunks(this.meta, batch)
		else for (const item of batch) manifest = await this.engine.writeChunk(this.meta, item.chunkIndex, item.data)
		if (this.closed) return
		this.manifest = manifest
		this.nextIndex = firstMissing(manifest)
		this.lastCommitAt = Date.now()
		this.queuePaused = false
		this.diskPaused = false
		this.updateDiskSpeed()
		this.callbacks.onUpdate(this.snapshot(), true)
		if (this.isComplete()) this.resolveComplete(manifest)
	}

	private updateDiskSpeed() {
		const now = Date.now()
		const elapsed = now - this.speedSampleAt
		const bytes = this.manifest.receivedBytes - this.speedSampleBytes
		if (bytes > 0 && elapsed > 0) {
			const instant = bytes * 1000 / elapsed
			this.diskCommitBps = this.diskCommitBps ? this.diskCommitBps * 0.35 + instant * 0.65 : instant
			this.speedSampleAt = now
			this.speedSampleBytes = this.manifest.receivedBytes
		}
	}

	private receiveWindowBytes() {
		if (this.closed || this.pausedReason()) return 0
		const target = this.diskCommitBps
			? Math.max(LAN_LIMITS.minReceiveWindowBytes, Math.min(this.maxWindowBytes, this.diskCommitBps * 2))
			: LAN_LIMITS.minReceiveWindowBytes
		return Math.max(0, Math.floor(target - this.queuedBytes()))
	}

	private pausedReason() {
		if (this.diskPaused) return '磁盘写入较慢，已暂停发送'
		if (this.queuePaused) return '接收队列已满，正在等待磁盘'
		return undefined
	}

	private queuedBytes() {
		return this.pendingBytes + this.inFlightBytes
	}

	private hasWork() {
		return this.queuedBytes() > 0 || Boolean(this.writeTask)
	}

	private isComplete() {
		return this.manifest.receivedBytes === this.meta.size && this.manifest.receivedChunks === this.meta.chunkCount
	}

	private checkStall() {
		if (this.closed || !this.hasWork()) return
		const stalledFor = Date.now() - this.lastCommitAt
		if (stalledFor >= LAN_LIMITS.diskStallAbortMs) return this.fail('磁盘长时间没有写入进度，请重试此文件')
		if (stalledFor >= LAN_LIMITS.diskStallPauseMs && !this.diskPaused) {
			this.diskPaused = true
			this.callbacks.onUpdate(this.snapshot(), true)
		}
	}

	private fail(reason: string) {
		if (this.closed) return
		this.closed = true
		this.closeTimers()
		this.resolveComplete(null)
		this.callbacks.onFailure(reason)
	}

	private resolveComplete(manifest: TransferManifest | null) {
		for (const resolve of this.completeWaiters) resolve(manifest)
		this.completeWaiters.clear()
	}

	private closeTimers() {
		clearInterval(this.stallTimer)
		if (this.batchTimer) clearTimeout(this.batchTimer)
		this.batchTimer = null
	}
}
