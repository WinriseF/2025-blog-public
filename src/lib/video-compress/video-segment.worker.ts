import {
	BufferTarget,
	Conversion,
	ConversionCanceledError,
	Mp4OutputFormat,
	Output
} from 'mediabunny'
import { createVideoInput, videoConversionOptions, videoErrorMessage } from './media'
import type { VideoSegmentWorkerRequest, VideoSegmentWorkerResponse } from './types'

const PROGRESS_INTERVAL_MS = 350

type SegmentTask = {
	jobId: number
	conversion: Conversion
	pauseController: AbortController | null
	resume: (() => void) | null
	canceled: boolean
	activeElapsedMs: number
	runStartedAt: number
}

let activeTask: SegmentTask | null = null

function post(message: VideoSegmentWorkerResponse, transfer?: Transferable[]) {
	self.postMessage(message, { transfer })
}

function waitForResume(task: SegmentTask) {
	return new Promise<void>(resolve => {
		task.resume = resolve
	})
}

async function execute(task: SegmentTask, segment: Extract<VideoSegmentWorkerRequest, { type: 'encode' }>['segment']) {
	while (task.conversion.state !== 'done') {
		if (task.canceled) throw new ConversionCanceledError()
		const pauseController = new AbortController()
		task.pauseController = pauseController
		task.runStartedAt = performance.now()

		try {
			await task.conversion.execute({ pauseSignal: pauseController.signal })
		} finally {
			task.activeElapsedMs += performance.now() - task.runStartedAt
			task.runStartedAt = 0
			task.pauseController = null
		}

		if (task.canceled) throw new ConversionCanceledError()
		if (task.conversion.state === 'idle') {
			post({ type: 'paused', jobId: task.jobId, segment })
			await waitForResume(task)
			task.resume = null
		}
	}
}

async function encodeSegment(request: Extract<VideoSegmentWorkerRequest, { type: 'encode' }>) {
	if (activeTask) {
		post({ type: 'error', jobId: request.jobId, message: '分段 Worker 正在处理其它任务' })
		return
	}

	const input = createVideoInput(request.file)
	const target = new BufferTarget()
	try {
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target })
		const conversion = await Conversion.init({
			input,
			output,
			tracks: 'primary',
			trim: { start: request.segment.start, end: request.segment.end },
			showWarnings: false,
			tags: {},
			video: await videoConversionOptions(request.config),
			audio: { discard: true }
		})
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!conversion.isValid || !videoTrack || !conversion.utilizedTracks.includes(videoTrack)) {
			throw new Error('当前浏览器无法创建目标视频编码配置')
		}

		const task: SegmentTask = {
			jobId: request.jobId,
			conversion,
			pauseController: null,
			resume: null,
			canceled: false,
			activeElapsedMs: 0,
			runStartedAt: 0
		}
		activeTask = task
		let lastProgressAt = 0
		conversion.onProgress = (progress, processedTime) => {
			const now = performance.now()
			if (progress < 1 && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
			lastProgressAt = now
			const elapsedMs = task.activeElapsedMs + (task.runStartedAt ? now - task.runStartedAt : 0)
			post({
				type: 'progress',
				jobId: request.jobId,
				segment: request.segment,
				progress,
				processedTime,
				speed: elapsedMs > 0 ? processedTime / (elapsedMs / 1000) : 0
			})
		}

		await execute(task, request.segment)
		const buffer = target.buffer
		if (!buffer) throw new Error('分段视频没有生成有效数据')
		post({ type: 'complete', jobId: request.jobId, segment: request.segment, buffer, elapsedMs: task.activeElapsedMs }, [buffer])
	} catch (error) {
		if (error instanceof ConversionCanceledError || activeTask?.canceled) {
			post({ type: 'canceled', jobId: request.jobId })
		} else {
			post({ type: 'error', jobId: request.jobId, message: videoErrorMessage(error) })
		}
	} finally {
		input.dispose()
		activeTask = null
	}
}

self.onmessage = (event: MessageEvent<VideoSegmentWorkerRequest>) => {
	const request = event.data
	if (request.type === 'encode') {
		void encodeSegment(request)
		return
	}
	if (!activeTask || activeTask.jobId !== request.jobId) return

	if (request.type === 'pause') {
		activeTask.pauseController?.abort()
		return
	}
	if (request.type === 'resume') {
		activeTask.resume?.()
		return
	}

	activeTask.canceled = true
	activeTask.pauseController?.abort()
	activeTask.resume?.()
	void activeTask.conversion.cancel().catch(() => undefined)
}
