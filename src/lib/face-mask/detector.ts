import { expandBox } from './geometry'
import type { Rect } from './types'

const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm'
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite'

type FaceDetectorInstance = {
	detect: (source: ImageBitmap | HTMLImageElement | HTMLCanvasElement) => unknown | Promise<unknown>
}

type MediaPipeVisionModule = {
	FilesetResolver: {
		forVisionTasks: (wasmUrl: string) => Promise<unknown>
	}
	FaceDetector: {
		createFromOptions: (
			vision: unknown,
			options: {
				baseOptions: {
					modelAssetPath: string
				}
				runningMode: 'IMAGE'
			}
		) => Promise<FaceDetectorInstance>
	}
}

type DetectionResult = {
	detections?: Array<{
		boundingBox?: {
			originX?: number
			originY?: number
			x?: number
			y?: number
			width?: number
			height?: number
		}
	}>
}

let detectorPromise: Promise<FaceDetectorInstance> | null = null

function isBenignMediaPipeLog(args: unknown[]) {
	const text = args.map(item => String(item)).join(' ')
	return (
		text.includes('Created TensorFlow Lite XNNPACK delegate for CPU') ||
		text.includes('Feedback manager requires a model with a single signature inference') ||
		text.includes('Feedback tensors')
	)
}

async function silenceBenignMediaPipeLogs<T>(task: () => T | Promise<T>) {
	const originalError = console.error
	console.error = (...args: unknown[]) => {
		if (isBenignMediaPipeLog(args)) return
		originalError(...args)
	}

	try {
		return await task()
	} finally {
		console.error = originalError
	}
}

async function loadDetector() {
	if (!detectorPromise) {
		detectorPromise = (async () => {
			const moduleUrl = TASKS_VISION_URL
			const visionTasks = (await import(/* webpackIgnore: true */ moduleUrl)) as MediaPipeVisionModule
			const vision = await visionTasks.FilesetResolver.forVisionTasks(WASM_URL)
			return silenceBenignMediaPipeLogs(() =>
				visionTasks.FaceDetector.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath: MODEL_URL
					},
					runningMode: 'IMAGE'
				})
			)
		})()
	}

	return detectorPromise
}

function readBox(detection: NonNullable<DetectionResult['detections']>[number], imageWidth: number, imageHeight: number): Rect | null {
	const box = detection.boundingBox
	if (!box) return null

	const x = Number(box.originX ?? box.x ?? 0)
	const y = Number(box.originY ?? box.y ?? 0)
	const width = Number(box.width ?? 0)
	const height = Number(box.height ?? 0)

	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null
	if (width <= 0 || height <= 0) return null

	return expandBox({ x, y, width, height }, imageWidth, imageHeight)
}

export async function detectFaceRects(source: ImageBitmap, imageWidth: number, imageHeight: number) {
	const detector = await loadDetector()
	const result = (await silenceBenignMediaPipeLogs(() => detector.detect(source))) as DetectionResult
	const detections = result.detections ?? []

	return detections.map(detection => readBox(detection, imageWidth, imageHeight)).filter((rect): rect is Rect => Boolean(rect))
}
