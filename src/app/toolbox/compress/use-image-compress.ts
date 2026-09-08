'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { computeTargetSize } from '@/lib/image-compress/presets'
import { IMAGE_FORMAT_META, inspectImageContainer } from '@/lib/image-compress/sniff'
import type {
	ImageCompressionOptions,
	ImageCompressionResult,
	ImageDeviceLimits,
	ImageFormat,
	ImageJobStage,
	ImageWorkerRequest,
	ImageWorkerResponse
} from '@/lib/image-compress/types'

export type ImageItemStatus = 'ready' | 'queued' | 'processing' | 'done' | 'error' | 'canceled'
export type ImageResult = Omit<ImageCompressionResult, 'bytes'> & { blob: Blob; url: string }
export type ImageCompressionItem = {
	id: string
	file: File
	previewUrl: string
	format: ImageFormat
	width: number
	height: number
	status: ImageItemStatus
	stage?: ImageJobStage
	progress: number
	error?: string
	result?: ImageResult
}

type QueueTask = { id: string; options: ImageCompressionOptions; limits: ImageDeviceLimits }
type WorkerSlot = { worker: Worker | null; jobId: string | null }

const HEADER_BYTES = 1024 * 1024

function disposeResult(result?: ImageResult) {
	if (result) URL.revokeObjectURL(result.url)
}

function limitsForDevice(): ImageDeviceLimits {
	const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number }
	const memory = navigatorWithMemory.deviceMemory
	const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	const lowMemory = ios || memory === undefined || memory <= 4
	return { lowMemory, maxPixels: lowMemory ? 24_000_000 : 56_000_000 }
}

function workerCount(items: ImageCompressionItem[], options: ImageCompressionOptions, limits: ImageDeviceLimits) {
	const heavyInput = items.some(item => !item.width || !item.height || item.width * item.height > 24_000_000)
	const encodesAvif = options.output === 'avif'
		|| (options.output === 'auto' && options.compatibility === 'smallest')
		|| ((options.output === 'keep' || options.output === 'auto') && items.some(item => item.format === 'avif'))
	if (limits.lowMemory || heavyInput || encodesAvif) return 1
	const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0
	return memory >= 8 && navigator.hardwareConcurrency >= 8 ? 2 : 1
}

function unsupportedMessage(format: ReturnType<typeof inspectImageContainer>['format']) {
	if (format === 'gif') return 'GIF 暂不支持，动态图不会被静默转换成第一帧'
	if (format === 'heic') return 'HEIC/HEIF 暂不支持，避免 HDR、广色域和高位深内容被静默降质'
	if (format === 'svg') return 'SVG 是矢量文档，不进入栅格图片压缩流程'
	return '无法识别图片真实格式，仅支持静态 JPEG、PNG、WebP 和 AVIF'
}

async function inspectFile(file: File) {
	const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
	const info = inspectImageContainer(bytes)
	if (!['jpeg', 'png', 'webp', 'avif'].includes(info.format)) throw new Error(unsupportedMessage(info.format))
	if (info.animated) throw new Error('检测到动态图，当前版本不会破坏动画或自动提取第一帧')
	return info as typeof info & { format: ImageFormat }
}

async function decodeOnMainThread(file: File, options: ImageCompressionOptions, limits: ImageDeviceLimits, knownWidth: number, knownHeight: number) {
	let source: CanvasImageSource
	let width: number
	let height: number
	let dispose = () => {}
	let protectiveResize = false
	if (typeof createImageBitmap === 'function') {
		const knownPixels = knownWidth * knownHeight
		const target = computeTargetSize(knownWidth || 1, knownHeight || 1, options.maxWidth, limits.maxPixels)
		protectiveResize = knownPixels > limits.maxPixels * 1.35
		let bitmap: ImageBitmap
		try {
			bitmap = protectiveResize
				? await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' })
				: await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
		} catch {
			protectiveResize = false
			bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
		}
		source = bitmap
		width = bitmap.width
		height = bitmap.height
		dispose = () => bitmap.close()
	} else {
		const url = URL.createObjectURL(file)
		try {
			const image = new Image()
			image.src = url
			await new Promise<void>((resolve, reject) => {
				image.onload = () => resolve()
				image.onerror = () => reject(new Error('浏览器无法解码这张图片'))
			})
			source = image
			width = image.naturalWidth
			height = image.naturalHeight
			dispose = () => URL.revokeObjectURL(url)
		} catch (error) {
			URL.revokeObjectURL(url)
			throw error
		}
	}
	try {
		const target = computeTargetSize(width, height, options.maxWidth, limits.maxPixels)
		const canvas = document.createElement('canvas')
		canvas.width = target.width
		canvas.height = target.height
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('无法创建兼容解码画布')
		context.imageSmoothingEnabled = true
		context.imageSmoothingQuality = 'high'
		context.drawImage(source, 0, 0, target.width, target.height)
		const image = context.getImageData(0, 0, target.width, target.height)
		const data = image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.data.byteLength) as ArrayBuffer
		const warnings = ['当前浏览器使用主线程解码兼容路径']
		if (protectiveResize) warnings.push('为避免大图导致浏览器内存不足，已在解码阶段限制像素数量')
		if (target.width !== width || target.height !== height) warnings.push('兼容路径使用浏览器高质量缩放')
		return { data, width: target.width, height: target.height, warnings }
	} finally {
		dispose()
	}
}

export function useImageCompress() {
	const [items, setItems] = useState<ImageCompressionItem[]>([])
	const itemsRef = useRef<ImageCompressionItem[]>([])
	const queueRef = useRef<QueueTask[]>([])
	const tasksRef = useRef(new Map<string, QueueTask>())
	const slotsRef = useRef<WorkerSlot[]>([])
	const concurrencyRef = useRef(1)
	const mountedRef = useRef(true)
	const pumpRef = useRef<() => void>(() => {})

	const updateItems = useCallback((updater: (current: ImageCompressionItem[]) => ImageCompressionItem[]) => {
		setItems(current => {
			const next = updater(current)
			itemsRef.current = next
			return next
		})
	}, [])

	const updateItem = useCallback((id: string, updater: (item: ImageCompressionItem) => ImageCompressionItem) => {
		updateItems(current => current.map(item => item.id === id ? updater(item) : item))
	}, [updateItems])

	const finishSlot = useCallback((slot: WorkerSlot) => {
		if (slot.jobId) tasksRef.current.delete(slot.jobId)
		slot.jobId = null
		queueMicrotask(() => pumpRef.current())
	}, [])

	const failTask = useCallback((slot: WorkerSlot, id: string, message: string) => {
		updateItem(id, item => ({ ...item, status: 'error', progress: 0, error: message }))
		finishSlot(slot)
	}, [finishSlot, updateItem])

	const createWorker = useCallback((slot: WorkerSlot) => {
		if (slot.worker) return slot.worker
		const worker = new Worker(new URL('../../../lib/image-compress/image-compress.worker.ts', import.meta.url), { type: 'module' })
		worker.onmessage = event => {
			const response = event.data as ImageWorkerResponse
			if (response.jobId !== slot.jobId) return
			if (response.type === 'job:progress') {
				updateItem(response.jobId, item => ({ ...item, status: 'processing', stage: response.stage, progress: response.progress ?? item.progress }))
				return
			}
			if (response.type === 'job:needs-main-decode') {
				const task = tasksRef.current.get(response.jobId)
				const item = itemsRef.current.find(candidate => candidate.id === response.jobId)
				if (!task || !item) return
				void decodeOnMainThread(item.file, task.options, task.limits, item.width, item.height)
					.then(decoded => {
						if (slot.worker !== worker || slot.jobId !== item.id) return
						worker.postMessage({ type: 'job:start-decoded', jobId: item.id, file: item.file, options: task.options, limits: task.limits, decoded } satisfies ImageWorkerRequest, [decoded.data])
					})
					.catch(error => {
						if (slot.worker !== worker || slot.jobId !== item.id) return
						failTask(slot, item.id, error instanceof Error ? error.message : '兼容解码失败')
					})
				return
			}
			if (response.type === 'job:failed') {
				failTask(slot, response.jobId, response.message)
				return
			}

			const blob = new Blob([response.result.bytes], { type: response.result.mime })
			const url = URL.createObjectURL(blob)
			updateItem(response.jobId, item => {
				disposeResult(item.result)
				const { bytes: _, ...metadata } = response.result
				return { ...item, status: 'done', progress: 1, stage: undefined, error: undefined, width: metadata.width, height: metadata.height, result: { ...metadata, blob, url } }
			})
			finishSlot(slot)
		}
		worker.onerror = event => {
			event.preventDefault()
			const id = slot.jobId
			worker.terminate()
			slot.worker = null
			if (id) failTask(slot, id, event.message || '图片处理 Worker 运行异常')
		}
		worker.onmessageerror = () => {
			const id = slot.jobId
			worker.terminate()
			slot.worker = null
			if (id) failTask(slot, id, '无法读取图片处理结果')
		}
		slot.worker = worker
		return worker
	}, [failTask, finishSlot, updateItem])

	const pump = useCallback(() => {
		if (!mountedRef.current) return
		while (slotsRef.current.length < concurrencyRef.current) slotsRef.current.push({ worker: null, jobId: null })
		for (const slot of slotsRef.current.slice(0, concurrencyRef.current)) {
			if (slot.jobId) continue
			const task = queueRef.current.shift()
			if (!task) break
			const item = itemsRef.current.find(candidate => candidate.id === task.id)
			if (!item) continue
			slot.jobId = task.id
			tasksRef.current.set(task.id, task)
			updateItem(task.id, current => {
				disposeResult(current.result)
				return { ...current, result: undefined, status: 'processing', stage: 'validate', progress: 0.02, error: undefined }
			})
			createWorker(slot).postMessage({ type: 'job:start', jobId: task.id, file: item.file, options: task.options, limits: task.limits } satisfies ImageWorkerRequest)
		}
	}, [createWorker, updateItem])

	pumpRef.current = pump

	const addFiles = useCallback(async (fileList: FileList | File[]) => {
		const incoming = Array.from(fileList)
		const accepted: ImageCompressionItem[] = []
		const rejected: string[] = []
		for (const file of incoming) {
			if (itemsRef.current.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified) || accepted.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue
			try {
				const info = await inspectFile(file)
				accepted.push({
					id: crypto.randomUUID(),
					file,
					previewUrl: URL.createObjectURL(file),
					format: info.format,
					width: info.width,
					height: info.height,
					status: 'ready',
					progress: 0
				})
			} catch (error) {
				rejected.push(`${file.name}: ${error instanceof Error ? error.message : '读取失败'}`)
			}
		}
		if (accepted.length) updateItems(current => [...current, ...accepted])
		return { accepted: accepted.length, rejected }
	}, [updateItems])

	const start = useCallback((ids: string[], options: ImageCompressionOptions) => {
		const uniqueIds = [...new Set(ids)].filter(id => {
			const item = itemsRef.current.find(candidate => candidate.id === id)
			return item && item.status !== 'processing' && item.status !== 'queued'
		})
		if (!uniqueIds.length) return
		const limits = limitsForDevice()
		const selected = itemsRef.current.filter(item => uniqueIds.includes(item.id))
		concurrencyRef.current = workerCount(selected, options, limits)
		const tasks = uniqueIds.map(id => ({ id, options: { ...options }, limits }))
		queueRef.current.push(...tasks)
		updateItems(current => current.map(item => uniqueIds.includes(item.id) ? { ...item, status: 'queued', progress: 0, error: undefined } : item))
		pumpRef.current()
	}, [updateItems])

	const cancel = useCallback((id: string) => {
		const queued = queueRef.current.some(task => task.id === id)
		queueRef.current = queueRef.current.filter(task => task.id !== id)
		if (queued) updateItem(id, item => ({ ...item, status: 'canceled', progress: 0, stage: undefined }))
		const slot = slotsRef.current.find(candidate => candidate.jobId === id)
		if (!slot) return
		slot.worker?.terminate()
		slot.worker = null
		tasksRef.current.delete(id)
		slot.jobId = null
		updateItem(id, item => ({ ...item, status: 'canceled', progress: 0, stage: undefined }))
		pumpRef.current()
	}, [updateItem])

	const cancelAll = useCallback(() => {
		const ids = new Set([...queueRef.current.map(task => task.id), ...slotsRef.current.flatMap(slot => slot.jobId ? [slot.jobId] : [])])
		queueRef.current = []
		tasksRef.current.clear()
		for (const slot of slotsRef.current) {
			slot.worker?.terminate()
			slot.worker = null
			slot.jobId = null
		}
		updateItems(current => current.map(item => ids.has(item.id) ? { ...item, status: 'canceled', progress: 0, stage: undefined } : item))
	}, [updateItems])

	const remove = useCallback((id: string) => {
		cancel(id)
		updateItems(current => {
			const item = current.find(candidate => candidate.id === id)
			if (item) {
				URL.revokeObjectURL(item.previewUrl)
				disposeResult(item.result)
			}
			return current.filter(candidate => candidate.id !== id)
		})
	}, [cancel, updateItems])

	const clear = useCallback(() => {
		cancelAll()
		for (const item of itemsRef.current) {
			URL.revokeObjectURL(item.previewUrl)
			disposeResult(item.result)
		}
		itemsRef.current = []
		setItems([])
	}, [cancelAll])

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			queueRef.current = []
			for (const slot of slotsRef.current) slot.worker?.terminate()
			for (const item of itemsRef.current) {
				URL.revokeObjectURL(item.previewUrl)
				disposeResult(item.result)
			}
		}
	}, [])

	return {
		items,
		addFiles,
		start,
		cancel,
		cancelAll,
		remove,
		clear,
		isActive: items.some(item => item.status === 'processing' || item.status === 'queued'),
		results: items.flatMap(item => item.result ? [{ item, result: item.result }] : [])
	}
}

export function formatImageType(format: ImageFormat) {
	return IMAGE_FORMAT_META[format].label
}
