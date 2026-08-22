'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	VideoCompressionConfig,
	VideoCompressionPhase,
	VideoInspection,
	VideoLaneProgress,
	VideoWorkerMode,
	VideoWorkerRequest,
	VideoWorkerResponse
} from '@/lib/video-compress/types'

type SaveFilePicker = (options?: {
	suggestedName?: string
	types?: Array<{ description?: string; accept: Record<string, string[]> }>
}) => Promise<FileSystemFileHandle>

type VideoCompressState = {
	phase: VideoCompressionPhase
	file: File | null
	inspection: VideoInspection | null
	error: string | null
	progress: number
	processedTime: number
	outputBytes: number
	elapsedMs: number
	speed: number
	workerCount: number
	lanes: VideoLaneProgress[]
	outputName: string | null
}

const INITIAL_STATE: VideoCompressState = {
	phase: 'idle',
	file: null,
	inspection: null,
	error: null,
	progress: 0,
	processedTime: 0,
	outputBytes: 0,
	elapsedMs: 0,
	speed: 0,
	workerCount: 1,
	lanes: [],
	outputName: null
}

const ACTIVE_PHASES = new Set<VideoCompressionPhase>(['preparing', 'running', 'pausing', 'paused', 'finalizing', 'canceling'])

function supportReason() {
	if (typeof window === 'undefined') return null
	if (!window.isSecureContext) return '视频压缩需要 HTTPS 安全环境'
	if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) return '当前浏览器不支持 WebCodecs，请使用最新版 Chrome 或 Edge'
	if (!('showSaveFilePicker' in window)) return '当前浏览器不能直接保存大文件，请使用桌面版 Chrome 或 Edge'
	if (typeof Worker === 'undefined') return '当前浏览器不支持后台视频处理'
	return null
}

function compressedName(name: string) {
	const base = name.replace(/\.[^.]+$/, '') || 'video'
	return `${base}-compressed.mp4`
}

export function useVideoCompress() {
	const [state, setState] = useState<VideoCompressState>(INITIAL_STATE)
	const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null)
	const workerRef = useRef<Worker | null>(null)
	const activeIdRef = useRef(0)
	const fileRef = useRef<File | null>(null)
	const activeRef = useRef(false)

	useEffect(() => setUnsupportedReason(supportReason()), [])

	const terminateWorker = useCallback(() => {
		workerRef.current?.terminate()
		workerRef.current = null
	}, [])

	const ensureWorker = useCallback(() => {
		if (workerRef.current) return workerRef.current
		const worker = new Worker(new URL('../../../lib/video-compress/video-compress.worker.ts', import.meta.url), { type: 'module' })

		worker.onmessage = (event: MessageEvent<VideoWorkerResponse>) => {
			const response = event.data
			if (response.id !== activeIdRef.current) return

			if (response.type === 'inspection') {
				setState(current => ({ ...current, phase: 'ready', inspection: response.inspection, error: null }))
				return
			}
			if (response.type === 'phase') {
				setState(current => ({ ...current, phase: response.phase }))
				return
			}
			if (response.type === 'progress') {
				setState(current => ({
					...current,
					progress: response.progress,
					processedTime: response.processedTime,
					outputBytes: response.outputBytes,
					elapsedMs: response.elapsedMs,
					speed: response.speed,
					workerCount: response.workerCount ?? 1,
					lanes: response.lanes ?? []
				}))
				return
			}
			if (response.type === 'complete') {
				activeRef.current = false
				setState(current => ({
					...current,
					phase: 'done',
					progress: 1,
					outputBytes: response.outputBytes,
					elapsedMs: response.elapsedMs,
					lanes: []
				}))
				return
			}
			if (response.type === 'canceled') {
				activeRef.current = false
				setState(current => ({ ...current, phase: 'canceled', progress: 0, outputBytes: 0, lanes: [] }))
				return
			}

			activeRef.current = false
			setState(current => ({ ...current, phase: 'error', error: response.message }))
		}

		worker.onerror = event => {
			event.preventDefault()
			activeRef.current = false
			setState(current => ({ ...current, phase: 'error', error: event.message || '视频处理 Worker 运行异常' }))
			terminateWorker()
		}
		worker.onmessageerror = () => {
			activeRef.current = false
			setState(current => ({ ...current, phase: 'error', error: '无法读取视频处理结果' }))
			terminateWorker()
		}

		workerRef.current = worker
		return worker
	}, [terminateWorker])

	const selectFile = useCallback((file: File) => {
		if (activeRef.current) return
		const id = ++activeIdRef.current
		fileRef.current = file
		setState({ ...INITIAL_STATE, phase: 'inspecting', file })
		const request: VideoWorkerRequest = { type: 'inspect', id, file }
		ensureWorker().postMessage(request)
	}, [ensureWorker])

	const start = useCallback(async (config: VideoCompressionConfig, workerMode: VideoWorkerMode) => {
		const file = fileRef.current
		if (!file || activeRef.current || unsupportedReason) return
		const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
		if (!picker) return

		let outputHandle: FileSystemFileHandle
		try {
			outputHandle = await picker.call(window, {
				suggestedName: compressedName(file.name),
				types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }]
			})
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return
			setState(current => ({ ...current, phase: 'error', error: error instanceof Error ? error.message : '无法选择保存位置' }))
			return
		}

		activeRef.current = true
		setState(current => ({
			...current,
			phase: 'preparing',
			error: null,
			progress: 0,
			processedTime: 0,
			outputBytes: 0,
			elapsedMs: 0,
			speed: 0,
			workerCount: 1,
			lanes: [],
			outputName: outputHandle.name
		}))
		const request: VideoWorkerRequest = { type: 'start', id: activeIdRef.current, file, outputHandle, config, workerMode }
		ensureWorker().postMessage(request)
	}, [ensureWorker, unsupportedReason])

	const pause = useCallback(() => {
		if (state.phase !== 'running') return
		setState(current => ({ ...current, phase: 'pausing' }))
		ensureWorker().postMessage({ type: 'pause', id: activeIdRef.current } satisfies VideoWorkerRequest)
	}, [ensureWorker, state.phase])

	const resume = useCallback(() => {
		if (state.phase !== 'paused') return
		ensureWorker().postMessage({ type: 'resume', id: activeIdRef.current } satisfies VideoWorkerRequest)
	}, [ensureWorker, state.phase])

	const cancel = useCallback(() => {
		if (!activeRef.current || state.phase === 'finalizing') return
		setState(current => ({ ...current, phase: 'canceling' }))
		ensureWorker().postMessage({ type: 'cancel', id: activeIdRef.current } satisfies VideoWorkerRequest)
	}, [ensureWorker, state.phase])

	const reset = useCallback(() => {
		if (activeRef.current) return
		activeIdRef.current += 1
		fileRef.current = null
		terminateWorker()
		setState(INITIAL_STATE)
	}, [terminateWorker])

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!activeRef.current) return
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', handleBeforeUnload)
		return () => window.removeEventListener('beforeunload', handleBeforeUnload)
	}, [])

	useEffect(() => () => terminateWorker(), [terminateWorker])

	return {
		...state,
		unsupportedReason,
		isActive: ACTIVE_PHASES.has(state.phase),
		selectFile,
		start,
		pause,
		resume,
		cancel,
		reset
	}
}
