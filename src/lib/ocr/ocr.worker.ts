import { PaddleOcrService, V6_MEDIUM_MODEL, V6_SMALL_MODEL, V6_TINY_MODEL } from 'ppu-paddle-ocr/web'
import type { OcrErrorPhase, OcrModel, OcrWorkerRequest, OcrWorkerResponse } from './types'

const MODEL_BY_KEY = {
	tiny: V6_TINY_MODEL,
	small: V6_SMALL_MODEL,
	medium: V6_MEDIUM_MODEL
} satisfies Record<OcrModel, typeof V6_SMALL_MODEL>

const MEDIUM_MIN_SIDE = 736
const MEDIUM_MAX_SIDE = 4000

let service: PaddleOcrService | null = null
let initialization: Promise<PaddleOcrService> | null = null
let serviceModel: OcrModel | null = null
let activeRequestId: number | null = null

function post(message: OcrWorkerResponse) {
	self.postMessage(message)
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : '未知错误'
}

async function prepareInput(image: ArrayBuffer, model: OcrModel) {
	if (model !== 'medium') {
		return { source: image, scaleX: 1, scaleY: 1 }
	}

	const bitmap = await createImageBitmap(new Blob([image]))
	try {
		let ratio = Math.max(1, MEDIUM_MIN_SIDE / Math.min(bitmap.width, bitmap.height))
		if (Math.max(bitmap.width, bitmap.height) * ratio > MEDIUM_MAX_SIDE) {
			ratio = MEDIUM_MAX_SIDE / Math.max(bitmap.width, bitmap.height)
		}

		// Match PaddleOCR's DetResizeForTest: resize the short side, then align to 32px.
		const targetWidth = Math.max(32, Math.round((bitmap.width * ratio) / 32) * 32)
		const targetHeight = Math.max(32, Math.round((bitmap.height * ratio) / 32) * 32)
		const canvas = new OffscreenCanvas(targetWidth, targetHeight)
		const context = canvas.getContext('2d')
		if (!context) throw new Error('无法创建 Medium 模型预处理画布')

		context.imageSmoothingEnabled = true
		context.imageSmoothingQuality = 'high'
		context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
		return {
			source: canvas,
			scaleX: targetWidth / bitmap.width,
			scaleY: targetHeight / bitmap.height
		}
	} finally {
		bitmap.close()
	}
}

async function getService(model: OcrModel) {
	if (service && serviceModel === model) return service
	if (initialization) return initialization

	if (service) {
		await service.destroy()
		service = null
		serviceModel = null
	}

	const nextService = new PaddleOcrService({
		model: MODEL_BY_KEY[model],
		...(model === 'medium' && {
			detection: { maxSideLength: MEDIUM_MAX_SIDE },
			session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
		})
	})
	const nextInitialization = nextService
		.initialize()
		.then(() => {
			service = nextService
			serviceModel = model
			return nextService
		})
		.catch(async error => {
			await nextService.destroy().catch(() => undefined)
			throw error
		})
	initialization = nextInitialization

	try {
		return await nextInitialization
	} finally {
		initialization = null
	}
}

function postError(id: number, phase: OcrErrorPhase, error: unknown) {
	post({ id, type: 'error', phase, message: getErrorMessage(error) })
}

self.onmessage = async (event: MessageEvent<OcrWorkerRequest>) => {
	const { id, type, model, image } = event.data
	if (type !== 'recognize') return

	if (activeRequestId !== null) {
		postError(id, 'recognize', new Error('已有识别任务正在运行'))
		return
	}

	activeRequestId = id
	let currentService: PaddleOcrService

	try {
		if (!service || serviceModel !== model) post({ id, type: 'status', status: 'initializing' })
		currentService = await getService(model)
	} catch (error) {
		activeRequestId = null
		postError(id, 'initialize', error)
		return
	}

	post({ id, type: 'status', status: 'recognizing' })

	try {
		const prepared = await prepareInput(image, model)
		const result = await currentService.recognize(prepared.source)
		const items = result.lines.flat().map(item => ({
			text: item.text,
			confidence: item.confidence,
			box: {
				x: item.box.x / prepared.scaleX,
				y: item.box.y / prepared.scaleY,
				width: item.box.width / prepared.scaleX,
				height: item.box.height / prepared.scaleY
			}
		}))

		post({
			id,
			type: 'success',
			text: result.text,
			confidence: result.confidence,
			items
		})
	} catch (error) {
		postError(id, 'recognize', error)
	} finally {
		activeRequestId = null
	}
}
