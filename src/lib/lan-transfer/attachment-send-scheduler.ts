import { encodeChunk, encodeControl, LanAttachmentChunkReader, nextMissingChunkIndex, receivedBytesFromRanges } from './file-transfer'
import type { ChunkRange } from './storage/ranges'
import type { LanConnectionTransport } from './transport-types'
import { LAN_LIMITS, type LanControlMessage, type PreparedLanAttachment } from './types'

type SchedulerTask = {
	file: PreparedLanAttachment
	receivedRanges: ChunkRange[]
	ackedBytes: number
	scheduledBytes: number
	nextIndex: number
	state: 'ready' | 'confirming'
	active: boolean
	wasActive: boolean
	urgent: boolean
	announced: boolean
	reader: LanAttachmentChunkReader | null
}

type SchedulerContext = {
	transport: LanConnectionTransport
	mobile: boolean
	controller: AbortController
}

type SchedulerCallbacks = {
	createCompleteMessage: (file: PreparedLanAttachment) => LanControlMessage
	onTaskStarted: (file: PreparedLanAttachment) => void
	onTaskConfirming: (file: PreparedLanAttachment) => void
	onTaskError: (file: PreparedLanAttachment, reason: string) => void
	onTransportStalled: (reason: string) => void
}

class TransportWriteError extends Error {}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}

function cloneRanges(ranges: ChunkRange[]) {
	return ranges.map(range => [...range] as ChunkRange)
}

function isPriorityTask(file: PreparedLanAttachment) {
	return file.kind === 'image' || file.kind === 'voice' || file.size <= LAN_LIMITS.schedulerPriorityMaxBytes
}

function clampBytes(bytes: number, size: number) {
	return Math.max(0, Math.min(size, bytes))
}

export class LanAttachmentSendScheduler {
	private tasks = new Map<string, SchedulerTask>()
	private context: SchedulerContext | null = null
	private paused = true
	private pumpTask: Promise<void> | null = null
	private currentTaskId = ''
	private roundRobinIndex = 0
	private wakeResolver: (() => void) | null = null

	constructor(private readonly callbacks: SchedulerCallbacks) {}

	attach(transport: LanConnectionTransport, mobile: boolean) {
		this.context?.controller.abort()
		this.wake()
		this.context = { transport, mobile, controller: new AbortController() }
		this.paused = true
		this.tasks.forEach(task => this.deactivate(task))
	}

	setMobile(mobile: boolean) {
		if (this.context) this.context.mobile = mobile
		this.wakeAndPump()
	}

	detach() {
		this.context?.controller.abort()
		this.context = null
		this.paused = true
		this.tasks.forEach(task => this.deactivate(task))
		this.wake()
	}

	clear() {
		this.detach()
		this.tasks.clear()
		this.roundRobinIndex = 0
	}

	pause() {
		this.paused = true
		if (this.context) {
			this.context.controller.abort()
			this.context.controller = new AbortController()
		}
		this.wake()
	}

	resume() {
		this.paused = false
		if (this.context?.controller.signal.aborted) this.context.controller = new AbortController()
		this.wakeAndPump()
	}

	upsert(file: PreparedLanAttachment, ackedBytes: number, receivedRanges: ChunkRange[]) {
		const existing = this.tasks.get(file.id)
		if (existing) {
			this.updateAck(file.id, ackedBytes)
			return
		}
		this.tasks.set(file.id, this.createTask(file, ackedBytes, receivedRanges))
		this.wakeAndPump()
	}

	sync(file: PreparedLanAttachment, ackedBytes: number, receivedRanges: ChunkRange[], ready: boolean) {
		if (!ready) {
			this.remove(file.id)
			return
		}
		const task = this.tasks.get(file.id) || this.createTask(file, ackedBytes, receivedRanges)
		task.reader?.clear()
		task.file = file
		task.receivedRanges = cloneRanges(receivedRanges)
		task.ackedBytes = clampBytes(ackedBytes, file.size)
		task.scheduledBytes = Math.max(task.ackedBytes, receivedBytesFromRanges(file, task.receivedRanges))
		task.nextIndex = 0
		task.state = 'ready'
		task.active = false
		task.wasActive = false
		task.urgent = isPriorityTask(file)
		task.announced = false
		task.reader = null
		this.tasks.set(file.id, task)
		this.wakeAndPump()
	}

	updateAck(id: string, ackedBytes: number) {
		const task = this.tasks.get(id)
		if (!task) return
		task.ackedBytes = Math.max(task.ackedBytes, clampBytes(ackedBytes, task.file.size))
		task.scheduledBytes = Math.max(task.scheduledBytes, task.ackedBytes)
		this.wakeAndPump()
	}

	remove(id: string) {
		const task = this.tasks.get(id)
		if (!task) return
		task.reader?.clear()
		this.tasks.delete(id)
		if (this.currentTaskId === id && this.context) {
			this.context.controller.abort()
			this.context.controller = new AbortController()
		}
		this.wakeAndPump()
	}

	private createTask(file: PreparedLanAttachment, ackedBytes: number, receivedRanges: ChunkRange[]): SchedulerTask {
		const ranges = cloneRanges(receivedRanges)
		const acked = clampBytes(ackedBytes, file.size)
		return {
			file,
			receivedRanges: ranges,
			ackedBytes: acked,
			scheduledBytes: Math.max(acked, receivedBytesFromRanges(file, ranges)),
			nextIndex: 0,
			state: 'ready',
			active: false,
			wasActive: false,
			urgent: isPriorityTask(file),
			announced: false,
			reader: null,
		}
	}

	private deactivate(task: SchedulerTask) {
		task.active = false
		task.reader?.clear()
		task.reader = null
	}

	private wake() {
		const resolve = this.wakeResolver
		this.wakeResolver = null
		resolve?.()
	}

	private wakeAndPump() {
		this.wake()
		this.startPump()
	}

	private startPump() {
		if (this.pumpTask || this.paused || !this.context?.transport.isOpen()) return
		const context = this.context
		this.pumpTask = this.pump(context).catch(error => {
			if (!isAbortError(error)) this.callbacks.onTransportStalled(error instanceof Error ? error.message : '发送暂停，请保持页面打开')
		}).finally(() => {
			this.pumpTask = null
			if (!this.paused && this.context?.transport.isOpen() && this.hasReadyTask()) this.startPump()
		})
	}

	private hasReadyTask() {
		return Array.from(this.tasks.values()).some(task => task.state === 'ready')
	}

	private admitTasks(context: SchedulerContext) {
		const maxActive = context.mobile ? LAN_LIMITS.mobileSchedulerMaxActive : LAN_LIMITS.schedulerMaxActive
		const active = () => Array.from(this.tasks.values()).filter(task => task.state === 'ready' && task.active)
		while (active().length > maxActive) {
			const victim = [...active()].reverse().find(task => !isPriorityTask(task.file)) || active().at(-1)
			if (!victim) break
			this.deactivate(victim)
		}
		const priorityWaiting = Array.from(this.tasks.values()).filter(task => task.state === 'ready' && !task.active && isPriorityTask(task.file))

		for (const task of priorityWaiting) {
			if (active().length >= maxActive) {
				const victim = active().find(item => !isPriorityTask(item.file))
				if (!victim) break
				this.deactivate(victim)
			}
			if (active().length >= maxActive) break
			task.active = true
			task.wasActive = true
			task.urgent = true
		}

		const waiting = Array.from(this.tasks.values())
			.filter(task => task.state === 'ready' && !task.active)
			.sort((a, b) => Number(b.wasActive) - Number(a.wasActive))
		for (const task of waiting) {
			if (active().length >= maxActive) break
			task.active = true
			task.wasActive = true
		}
	}

	private taskAhead(task: SchedulerTask) {
		return Math.max(0, task.scheduledBytes - task.ackedBytes)
	}

	private totalAhead() {
		let total = 0
		this.tasks.forEach(task => {
			total += this.taskAhead(task)
		})
		return total
	}

	private nextChunkIndex(task: SchedulerTask) {
		const next = nextMissingChunkIndex(task.file, task.receivedRanges, task.nextIndex)
		if (next >= 0) task.nextIndex = next
		return next
	}

	private isEligible(task: SchedulerTask, context: SchedulerContext) {
		if (!task.active || task.state !== 'ready') return false
		if (this.nextChunkIndex(task) < 0) return true
		const attachmentLimit = context.mobile ? LAN_LIMITS.mobileMaxAttachmentAheadBytes : LAN_LIMITS.maxAttachmentAheadBytes
		const globalLimit = context.mobile ? LAN_LIMITS.mobileMaxSenderAheadBytes : LAN_LIMITS.maxSenderAheadBytes
		return this.taskAhead(task) < attachmentLimit && this.totalAhead() < globalLimit
	}

	private selectTask(context: SchedulerContext) {
		const active = Array.from(this.tasks.values()).filter(task => this.isEligible(task, context))
		if (!active.length) return null
		const urgent = active.find(task => task.urgent)
		if (urgent) {
			urgent.urgent = false
			return urgent
		}
		const task = active[this.roundRobinIndex % active.length]
		this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(1, active.length)
		return task
	}

	private async pump(context: SchedulerContext) {
		const signal = context.controller.signal
		while (!signal.aborted && !this.paused && this.context === context && context.transport.isOpen()) {
			this.admitTasks(context)
			const task = this.selectTask(context)
			if (!task) {
				if (!this.hasReadyTask()) return
				await this.waitForWake(signal)
				continue
			}
			try {
				this.currentTaskId = task.file.id
				await this.sendTurn(context, task)
			} catch (error) {
				if (isAbortError(error)) return
				if (error instanceof TransportWriteError) {
					this.callbacks.onTransportStalled(error.message)
					await this.waitForRetry(signal)
					continue
				}
				this.remove(task.file.id)
				this.callbacks.onTaskError(task.file, error instanceof Error ? error.message : '发送失败')
			} finally {
				if (this.currentTaskId === task.file.id) this.currentTaskId = ''
			}
		}
	}

	private async sendTurn(context: SchedulerContext, task: SchedulerTask) {
		const { transport, mobile, controller } = context
		const signal = controller.signal
		const highWatermark = mobile ? LAN_LIMITS.mobileBufferHighWatermark : LAN_LIMITS.bufferHighWatermark
		const lowWatermark = mobile ? LAN_LIMITS.mobileBufferLowWatermark : LAN_LIMITS.bufferLowWatermark
		const attachmentLimit = mobile ? LAN_LIMITS.mobileMaxAttachmentAheadBytes : LAN_LIMITS.maxAttachmentAheadBytes
		const globalLimit = mobile ? LAN_LIMITS.mobileMaxSenderAheadBytes : LAN_LIMITS.maxSenderAheadBytes
		const weight = isPriorityTask(task.file) ? LAN_LIMITS.schedulerPriorityWeight : 1
		let budget = LAN_LIMITS.schedulerQuantumBytes * weight

		while (budget > 0 && task.active && task.state === 'ready') {
			this.assertCurrent(context, task, signal)
			const chunkIndex = this.nextChunkIndex(task)
			if (chunkIndex < 0) {
				this.sendComplete(transport, task)
				return
			}
			if (this.taskAhead(task) >= attachmentLimit || this.totalAhead() >= globalLimit) return
			task.reader ||= new LanAttachmentChunkReader(task.file)
			const chunk = await task.reader.read(chunkIndex, signal)
			this.assertCurrent(context, task, signal)
			const frame = encodeChunk(task.file.id, chunkIndex, chunk)
			if (frame.byteLength > task.file.chunkSize + LAN_LIMITS.dataChannelFrameHeaderReserve || frame.byteLength > LAN_LIMITS.dataChannelMaxFrameSize) throw new Error('文件发送失败，请重新发送')
			try {
				await transport.waitUntilWritable(highWatermark, lowWatermark, LAN_LIMITS.bufferDrainTimeoutMs, signal)
			} catch (error) {
				if (isAbortError(error)) throw error
				throw new TransportWriteError(error instanceof Error ? error.message : '发送暂停，请保持页面打开')
			}
			this.assertCurrent(context, task, signal)
			if (!transport.send(frame)) throw new TransportWriteError('连接已断开，正在等待恢复')
			if (!task.announced) {
				task.announced = true
				this.callbacks.onTaskStarted(task.file)
			}
			task.scheduledBytes += chunk.byteLength
			task.nextIndex = chunkIndex + 1
			budget -= chunk.byteLength
		}
		if (task.active && task.state === 'ready' && this.nextChunkIndex(task) < 0) {
			this.assertCurrent(context, task, signal)
			this.sendComplete(transport, task)
		}
	}

	private sendComplete(transport: LanConnectionTransport, task: SchedulerTask) {
		const sent = transport.send(encodeControl(this.callbacks.createCompleteMessage(task.file)))
		if (!sent) throw new TransportWriteError('连接已断开，正在等待恢复')
		task.state = 'confirming'
		this.deactivate(task)
		this.callbacks.onTaskConfirming(task.file)
	}

	private assertCurrent(context: SchedulerContext, task: SchedulerTask, signal: AbortSignal) {
		if (signal.aborted || this.context !== context || this.tasks.get(task.file.id) !== task || task.state !== 'ready') throw new DOMException('发送已暂停', 'AbortError')
		if (!context.transport.isOpen()) throw new TransportWriteError('连接已断开，正在等待恢复')
	}

	private waitForWake(signal: AbortSignal) {
		if (signal.aborted) return Promise.reject(new DOMException('发送已暂停', 'AbortError'))
		return new Promise<void>((resolve, reject) => {
			const abort = () => {
				cleanup()
				reject(new DOMException('发送已暂停', 'AbortError'))
			}
			const wake = () => {
				cleanup()
				resolve()
			}
			const cleanup = () => {
				if (this.wakeResolver === wake) this.wakeResolver = null
				signal.removeEventListener('abort', abort)
			}
			this.wakeResolver = wake
			signal.addEventListener('abort', abort, { once: true })
		})
	}

	private waitForRetry(signal: AbortSignal) {
		if (signal.aborted) return Promise.reject(new DOMException('发送已暂停', 'AbortError'))
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(done, 1000)
			function cleanup() {
				clearTimeout(timer)
				signal.removeEventListener('abort', abort)
			}
			function done() {
				cleanup()
				resolve()
			}
			function abort() {
				cleanup()
				reject(new DOMException('发送已暂停', 'AbortError'))
			}
			signal.addEventListener('abort', abort, { once: true })
		})
	}
}
