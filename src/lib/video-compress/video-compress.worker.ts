import {
	BufferSource,
	Conversion,
	ConversionCanceledError,
	EncodedPacket,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	Input,
	MP4,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	type StreamTargetChunk
} from 'mediabunny'
import { audioConversionOptions, createVideoInput, videoConversionOptions, videoErrorMessage } from './media'
import { estimateVideoOutputBytes } from './presets'
import type {
	VideoCompressionConfig,
	VideoInspection,
	VideoLaneProgress,
	VideoSegment,
	VideoSegmentWorkerRequest,
	VideoSegmentWorkerResponse,
	VideoWorkerRequest,
	VideoWorkerResponse
} from './types'

const PROGRESS_INTERVAL_MS = 350
const TARGET_SEGMENT_BYTES = 24 * 1024 * 1024

type DirectWritable = {
	write: (data: unknown) => Promise<void>
	close: () => Promise<void>
	abort: (reason?: unknown) => Promise<void>
}

type WritableFileHandle = FileSystemFileHandle & {
	createWritable: () => Promise<DirectWritable>
}

type Lane = {
	id: number
	worker: Worker
	segment: VideoSegment | null
	processedTime: number
	speed: number
}

type ActiveTask = {
	id: number
	canceled: boolean
	paused: boolean
	resumeWaiters: Array<() => void>
	conversion: Conversion | null
	audioConversion: Conversion | null
	pauseController: AbortController | null
	workers: Set<Worker>
	lanes: Lane[]
	directWritable: DirectWritable | null
	output: Output | null
	outputBytes: number
	workerCount: number
	activeElapsedMs: number
	runStartedAt: number
}

type SegmentEvent =
	| { type: 'complete'; lane: Lane; segment: VideoSegment; buffer: ArrayBuffer }
	| { type: 'error'; lane: Lane; message: string }
	| { type: 'canceled'; lane: Lane }

type FinalMux = {
	videoSource: EncodedVideoPacketSource
	decoderConfig: VideoDecoderConfig
	audioPromise: Promise<void>
	sequenceNumber: number
}

let activeTask: ActiveTask | null = null

function post(message: VideoWorkerResponse) {
	self.postMessage(message)
}

function createTask(id: number): ActiveTask {
	return {
		id,
		canceled: false,
		paused: false,
		resumeWaiters: [],
		conversion: null,
		audioConversion: null,
		pauseController: null,
		workers: new Set(),
		lanes: [],
		directWritable: null,
		output: null,
		outputBytes: 0,
		workerCount: 1,
		activeElapsedMs: 0,
		runStartedAt: 0
	}
}

function assertActive(task: ActiveTask) {
	if (task.canceled || activeTask !== task) throw new ConversionCanceledError()
}

function startClock(task: ActiveTask) {
	if (!task.runStartedAt) task.runStartedAt = performance.now()
}

function stopClock(task: ActiveTask) {
	if (!task.runStartedAt) return
	task.activeElapsedMs += performance.now() - task.runStartedAt
	task.runStartedAt = 0
}

function elapsedMs(task: ActiveTask) {
	return task.activeElapsedMs + (task.runStartedAt ? performance.now() - task.runStartedAt : 0)
}

function createDiskBridge(directWritable: DirectWritable) {
	return new WritableStream<StreamTargetChunk>({
		write: chunk => directWritable.write(chunk),
		close: () => Promise.resolve(),
		abort: reason => directWritable.abort(reason)
	})
}

async function inspectInput(input: Input, file: File): Promise<VideoInspection> {
	if (!(await input.canRead())) throw new Error('无法识别这个视频格式')
	const [format, tracks, videoTrack, audioTrack] = await Promise.all([
		input.getFormat(),
		input.getTracks(),
		input.getPrimaryVideoTrack(),
		input.getPrimaryAudioTrack()
	])
	if (!videoTrack) throw new Error('文件中没有可用的视频轨道')
	const selectedTracks = [videoTrack, ...(audioTrack ? [audioTrack] : [])]
	const durationPromise = input.getDurationFromMetadata(selectedTracks)
		.then(value => value ?? input.computeDuration(selectedTracks))
		.catch(() => null)
	const [videoCodec, audioCodec, width, height, frameRateMetrics, duration, videoBitrate, audioBitrate, hasHighDynamicRange, canDecode] = await Promise.all([
		videoTrack.getCodec(),
		audioTrack?.getCodec() ?? null,
		videoTrack.getDisplayWidth(),
		videoTrack.getDisplayHeight(),
		videoTrack.computeFrameRateMetrics({ targetPacketCount: 256 }).catch(() => null),
		durationPromise,
		videoTrack.getAverageBitrate().then(value => value ?? videoTrack.getBitrate()).catch(() => null),
		audioTrack?.getAverageBitrate().then(value => value ?? audioTrack.getBitrate()).catch(() => null) ?? null,
		videoTrack.hasHighDynamicRange().catch(() => false),
		videoTrack.canDecode()
	])
	if (!videoCodec || !canDecode) throw new Error('当前浏览器无法解码这个视频')
	if (audioTrack && !audioCodec) throw new Error('无法识别视频中的音频编码')
	const videoTrackCount = tracks.filter(track => track.type === 'video').length
	const audioTrackCount = tracks.filter(track => track.type === 'audio').length
	return {
		name: file.name,
		size: file.size,
		format: format.name,
		duration,
		width,
		height,
		frameRate: frameRateMetrics?.bestGuessFrameRate ?? null,
		videoCodec,
		audioCodec,
		videoBitrate,
		audioBitrate,
		videoTrackCount,
		audioTrackCount,
		extraTrackCount: Math.max(0, tracks.length - 1 - (audioTrack ? 1 : 0)),
		hasHighDynamicRange
	}
}

async function inspectFile(id: number, file: File) {
	const input = createVideoInput(file)
	try {
		post({ type: 'inspection', id, inspection: await inspectInput(input, file) })
	} catch (error) {
		post({ type: 'error', id, stage: 'inspect', message: videoErrorMessage(error) })
	} finally {
		input.dispose()
	}
}

function waitUntilResumed(task: ActiveTask) {
	if (!task.paused) return Promise.resolve()
	return new Promise<void>(resolve => task.resumeWaiters.push(resolve))
}

async function executeConversion(task: ActiveTask, conversion: Conversion) {
	while (conversion.state !== 'done') {
		assertActive(task)
		await waitUntilResumed(task)
		const pauseController = new AbortController()
		task.pauseController = pauseController
		try {
			await conversion.execute({ pauseSignal: pauseController.signal })
		} finally {
			task.pauseController = null
		}
	}
}

function emitProgress(task: ActiveTask, duration: number, completedDuration: number) {
	const activeDuration = task.lanes.reduce((total, lane) => total + lane.processedTime, 0)
	const processedTime = Math.min(duration, completedDuration + activeDuration)
	const elapsed = elapsedMs(task)
	const lanes: VideoLaneProgress[] = task.lanes.map(lane => ({
		lane: lane.id,
		segmentIndex: lane.segment?.index ?? null,
		start: lane.segment?.start ?? 0,
		end: lane.segment?.end ?? 0,
		progress: lane.segment ? Math.min(1, lane.processedTime / (lane.segment.end - lane.segment.start)) : 0,
		speed: lane.speed
	}))
	post({
		type: 'progress',
		id: task.id,
		progress: duration > 0 ? processedTime / duration : 0,
		processedTime,
		outputBytes: task.outputBytes,
		elapsedMs: elapsed,
		speed: elapsed > 0 ? processedTime / (elapsed / 1000) : 0,
		workerCount: task.workerCount,
		lanes
	})
}

async function runSingle(task: ActiveTask, file: File, outputHandle: FileSystemFileHandle, config: VideoCompressionConfig) {
	const input = createVideoInput(file)
	try {
		const directWritable = await (outputHandle as WritableFileHandle).createWritable()
		task.directWritable = directWritable
		const target = new StreamTarget(createDiskBridge(directWritable), { chunked: true })
		target.on('write', ({ end }) => {
			task.outputBytes = Math.max(task.outputBytes, end)
		})
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target })
		task.output = output
		const conversion = await Conversion.init({
			input,
			output,
			tracks: 'primary',
			showWarnings: false,
			tags: {},
			video: await videoConversionOptions(config),
			audio: await audioConversionOptions(input, config.audioBitrate)
		})
		task.conversion = conversion
		const videoTrack = await input.getPrimaryVideoTrack()
		const audioTrack = await input.getPrimaryAudioTrack()
		if (!conversion.isValid || !videoTrack || !conversion.utilizedTracks.includes(videoTrack)) throw new Error('当前浏览器无法创建目标视频编码配置')
		if (audioTrack && !conversion.utilizedTracks.includes(audioTrack)) throw new Error('当前浏览器无法保留视频中的音频轨道')

		let lastProgressAt = 0
		conversion.onProgress = (progress, processedTime) => {
			const now = performance.now()
			if (progress < 1 && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
			lastProgressAt = now
			const elapsed = elapsedMs(task)
			post({
				type: 'progress', id: task.id, progress, processedTime, outputBytes: task.outputBytes,
				elapsedMs: elapsed, speed: elapsed > 0 ? processedTime / (elapsed / 1000) : 0, workerCount: 1, lanes: []
			})
		}

		task.workerCount = 1
		startClock(task)
		post({ type: 'phase', id: task.id, phase: 'running' })
		await executeConversion(task, conversion)
		stopClock(task)
		post({ type: 'phase', id: task.id, phase: 'finalizing' })
		await directWritable.close()
		task.directWritable = null
		return { outputBytes: task.outputBytes, elapsedMs: elapsedMs(task) }
	} finally {
		input.dispose()
	}
}

function createSegmentWorker() {
	return new Worker(new URL('./video-segment.worker.ts', import.meta.url), { type: 'module' })
}

function createSegments(duration: number, config: VideoCompressionConfig) {
	const seconds = Math.min(180, Math.max(10, TARGET_SEGMENT_BYTES * 8 / config.videoBitrate))
	const framesPerSegment = Math.max(1, Math.round(seconds * config.frameRate))
	const totalFrames = Math.ceil(duration * config.frameRate)
	const segments: VideoSegment[] = []
	for (let startFrame = 0; startFrame < totalFrames; startFrame += framesPerSegment) {
		const endFrame = Math.min(totalFrames, startFrame + framesPerSegment)
		segments.push({
			index: segments.length,
			start: startFrame / config.frameRate,
			end: Math.min(duration, endFrame / config.frameRate)
		})
	}
	return segments
}

function descriptionBytes(description: VideoDecoderConfig['description']) {
	if (!description) return new Uint8Array()
	return ArrayBuffer.isView(description)
		? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
		: new Uint8Array(description)
}

function sameDecoderConfig(left: VideoDecoderConfig, right: VideoDecoderConfig) {
	if (left.codec !== right.codec || left.codedWidth !== right.codedWidth || left.codedHeight !== right.codedHeight) return false
	const leftDescription = descriptionBytes(left.description)
	const rightDescription = descriptionBytes(right.description)
	return leftDescription.length === rightDescription.length && leftDescription.every((value, index) => value === rightDescription[index])
}

async function initializeFinalMux(task: ActiveTask, output: Output, segmentTrack: NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>, audioInput: Input, config: VideoCompressionConfig): Promise<FinalMux> {
	const decoderConfig = await segmentTrack.getDecoderConfig()
	if (!decoderConfig) throw new Error('无法读取分段视频编码配置')
	const videoSource = new EncodedVideoPacketSource('avc')
	output.addVideoTrack(videoSource, { decoderConfig, frameRate: config.frameRate })
	const audioTrack = await audioInput.getPrimaryAudioTrack()
	let audioConversion: Conversion | null = null
	if (audioTrack) {
		audioConversion = await Conversion.init({
			input: audioInput,
			output,
			tracks: 'primary',
			composable: true,
			showWarnings: false,
			video: { discard: true },
			audio: await audioConversionOptions(audioInput, config.audioBitrate)
		})
		if (!audioConversion.utilizedTracks.includes(audioTrack)) throw new Error('当前浏览器无法保留视频中的音频轨道')
		task.audioConversion = audioConversion
	}
	await output.start()
	const audioPromise = audioConversion ? executeConversion(task, audioConversion) : Promise.resolve()
	return { videoSource, decoderConfig, audioPromise, sequenceNumber: 0 }
}

async function mergeSegment(task: ActiveTask, currentMux: FinalMux | null, output: Output, audioInput: Input, config: VideoCompressionConfig, segment: VideoSegment, buffer: ArrayBuffer) {
	const segmentInput = new Input({ formats: [MP4], source: new BufferSource(buffer) })
	try {
		const track = await segmentInput.getPrimaryVideoTrack()
		if (!track) throw new Error(`第 ${segment.index + 1} 个视频分段无效`)
		const decoderConfig = await track.getDecoderConfig()
		if (!decoderConfig) throw new Error(`第 ${segment.index + 1} 个视频分段缺少编码配置`)
		const mux = currentMux ?? await initializeFinalMux(task, output, track, audioInput, config)
		if (!sameDecoderConfig(mux.decoderConfig, decoderConfig)) throw new Error('并行编码器配置不一致，请改用较低并行数')

		const sink = new EncodedPacketSink(track)
		let first = true
		for await (const packet of sink.packets()) {
			assertActive(task)
			await waitUntilResumed(task)
			if (first && packet.type !== 'key') throw new Error(`第 ${segment.index + 1} 个视频分段没有从关键帧开始`)
			first = false
			await mux.videoSource.add(new EncodedPacket(packet.data, packet.type, segment.start + packet.timestamp, packet.duration, mux.sequenceNumber++))
		}
		return mux
	} finally {
		segmentInput.dispose()
	}
}

function createEventQueue() {
	const events: SegmentEvent[] = []
	const waiters: Array<(event: SegmentEvent) => void> = []
	return {
		push(event: SegmentEvent) {
			const waiter = waiters.shift()
			if (waiter) waiter(event)
			else events.push(event)
		},
		next() {
			const event = events.shift()
			return event ? Promise.resolve(event) : new Promise<SegmentEvent>(resolve => waiters.push(resolve))
		}
	}
}

async function runParallel(task: ActiveTask, file: File, inspection: VideoInspection, outputHandle: FileSystemFileHandle, config: VideoCompressionConfig, workerCount: number) {
	if (!inspection.duration) throw new Error('无法读取视频时长，不能进行并行压缩')
	const duration = inspection.duration
	const segments = createSegments(duration, config)
	const audioInput = createVideoInput(file)
	const directWritable = await (outputHandle as WritableFileHandle).createWritable()
	task.directWritable = directWritable
	const target = new StreamTarget(createDiskBridge(directWritable), { chunked: true })
	target.on('write', ({ end }) => {
		task.outputBytes = Math.max(task.outputBytes, end)
	})
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target })
	task.output = output
	task.workerCount = workerCount
	const queue = createEventQueue()
	let completedDuration = 0
	task.lanes = Array.from({ length: workerCount }, (_, index) => {
		const worker = createSegmentWorker()
		const lane: Lane = { id: index + 1, worker, segment: null, processedTime: 0, speed: 0 }
		task.workers.add(worker)
		worker.onmessage = (event: MessageEvent<VideoSegmentWorkerResponse>) => {
			const response = event.data
			if (response.type === 'progress') {
				lane.processedTime = response.processedTime
				lane.speed = response.speed
				emitProgress(task, duration, completedDuration)
			} else if (response.type === 'complete') {
				queue.push({ type: 'complete', lane, segment: response.segment, buffer: response.buffer })
			} else if (response.type === 'error') {
				queue.push({ type: 'error', lane, message: response.message })
			} else if (response.type === 'canceled') {
				queue.push({ type: 'canceled', lane })
			}
		}
		worker.onerror = event => queue.push({ type: 'error', lane, message: event.message || '分段 Worker 运行异常' })
		return lane
	})

	let nextAssignIndex = 0
	let nextMergeIndex = 0
	const completed = new Map<number, { segment: VideoSegment; buffer: ArrayBuffer }>()
	const maxBufferedSegments = workerCount + 2
	let mux: FinalMux | null = null
	const dispatch = () => {
		if (task.paused || completed.size >= maxBufferedSegments) return
		for (const lane of task.lanes) {
			if (lane.segment || nextAssignIndex >= segments.length || completed.size >= maxBufferedSegments) continue
			const segment = segments[nextAssignIndex++]!
			lane.segment = segment
			lane.processedTime = 0
			lane.speed = 0
			lane.worker.postMessage({ type: 'encode', jobId: task.id, file, config, segment } satisfies VideoSegmentWorkerRequest)
		}
	}

	try {
		startClock(task)
		post({ type: 'phase', id: task.id, phase: 'running' })
		dispatch()
		while (nextMergeIndex < segments.length) {
			assertActive(task)
			await waitUntilResumed(task)
			const ready = completed.get(nextMergeIndex)
			if (ready) {
				mux = await mergeSegment(task, mux, output, audioInput, config, ready.segment, ready.buffer)
				completed.delete(nextMergeIndex++)
				dispatch()
				continue
			}
			const event = await queue.next()
			if (event.type === 'error') throw new Error(event.message || '视频分段处理失败')
			if (event.type === 'canceled') throw new ConversionCanceledError()
			event.lane.segment = null
			event.lane.processedTime = 0
			event.lane.speed = 0
			completedDuration += event.segment.end - event.segment.start
			completed.set(event.segment.index, { segment: event.segment, buffer: event.buffer })
			emitProgress(task, duration, completedDuration)
			dispatch()
		}

		if (!mux) throw new Error('没有生成可合并的视频分段')
		post({ type: 'phase', id: task.id, phase: 'finalizing' })
		await mux.audioPromise
		assertActive(task)
		await output.finalize()
		stopClock(task)
		await directWritable.close()
		task.directWritable = null
		return { outputBytes: task.outputBytes, elapsedMs: elapsedMs(task) }
	} finally {
		for (const lane of task.lanes) lane.worker.terminate()
		task.workers.clear()
		audioInput.dispose()
	}
}

async function cancelTask(task: ActiveTask, reason?: unknown) {
	task.canceled = true
	stopClock(task)
	task.pauseController?.abort()
	for (const worker of task.workers) worker.postMessage({ type: 'cancel', jobId: task.id } satisfies VideoSegmentWorkerRequest)
	task.resumeWaiters.splice(0).forEach(resolve => resolve())
	await task.conversion?.cancel().catch(() => undefined)
	await task.audioConversion?.cancel().catch(() => undefined)
	if (task.directWritable) {
		await task.directWritable.abort(reason).catch(() => undefined)
		task.directWritable = null
	}
}

async function compressVideo(request: Extract<VideoWorkerRequest, { type: 'start' }>) {
	if (activeTask) {
		post({ type: 'error', id: request.id, stage: 'compress', message: '已有视频任务正在处理' })
		return
	}
	const task = createTask(request.id)
	activeTask = task
	const inspectionInput = createVideoInput(request.file)
	try {
		post({ type: 'phase', id: request.id, phase: 'preparing' })
		const inspection = await inspectInput(inspectionInput, request.file)
		assertActive(task)
		if (inspection.hasHighDynamicRange) throw new Error('暂不支持 HDR 视频，请先转换为 SDR 后再压缩')
		const estimatedOutputBytes = estimateVideoOutputBytes(inspection, request.config)
		if (estimatedOutputBytes !== null && estimatedOutputBytes >= request.file.size) throw new Error('当前设置预计不会减小文件，请降低码率后再试')
		const workerCount = request.workerMode === 'dual' ? 2 : 1
		assertActive(task)
		const result = workerCount === 1
			? await runSingle(task, request.file, request.outputHandle, request.config)
			: await runParallel(task, request.file, inspection, request.outputHandle, request.config, workerCount)
		post({ type: 'complete', id: request.id, ...result })
	} catch (error) {
		const canceled = task.canceled || error instanceof ConversionCanceledError
		await cancelTask(task, error)
		if (canceled) post({ type: 'canceled', id: request.id })
		else post({ type: 'error', id: request.id, stage: 'compress', message: videoErrorMessage(error) })
	} finally {
		inspectionInput.dispose()
		for (const worker of task.workers) worker.terminate()
		if (activeTask === task) activeTask = null
	}
}

self.onmessage = (event: MessageEvent<VideoWorkerRequest>) => {
	const request = event.data
	if (request.type === 'inspect') {
		if (!activeTask) void inspectFile(request.id, request.file)
		return
	}
	if (request.type === 'start') {
		void compressVideo(request)
		return
	}
	if (!activeTask || activeTask.id !== request.id) return
	if (request.type === 'pause') {
		if (activeTask.paused) return
		activeTask.paused = true
		stopClock(activeTask)
		activeTask.pauseController?.abort()
		for (const lane of activeTask.lanes) lane.worker.postMessage({ type: 'pause', jobId: request.id } satisfies VideoSegmentWorkerRequest)
		post({ type: 'phase', id: request.id, phase: 'paused' })
		return
	}
	if (request.type === 'resume') {
		activeTask.paused = false
		startClock(activeTask)
		for (const lane of activeTask.lanes) lane.worker.postMessage({ type: 'resume', jobId: request.id } satisfies VideoSegmentWorkerRequest)
		activeTask.resumeWaiters.splice(0).forEach(resolve => resolve())
		post({ type: 'phase', id: request.id, phase: 'running' })
		return
	}
	void cancelTask(activeTask)
}
