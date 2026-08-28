import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import type { OcrItem, OcrModel, OcrResult, OcrWorkerRequest, OcrWorkerResponse } from './ocr/types'

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist'
const MIN_NATIVE_TEXT_LENGTH = 20
const MAX_RENDER_SCALE = 2.5
const MAX_RENDER_SIDE = 2600
let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null

export type PdfExtractionStage = 'reading' | 'rendering' | 'initializing-ocr' | 'ocr'

export type PdfExtractionProgress = {
	pageNumber: number
	pageCount: number
	stage: PdfExtractionStage
}

export type PdfExtractionResult = {
	pages: PdfPageExtractionResult[]
	nativePages: number
	ocrPages: number
}

export type PdfPageExtractionResult = {
	pageNumber: number
	text: string
	method: 'native' | 'ocr'
	confidence: number | null
	items: OcrItem[]
	imageWidth: number | null
	imageHeight: number | null
}

type PdfExtractionOptions = {
	model: OcrModel
	signal: AbortSignal
	initialResult?: PdfExtractionResult | null
	onProgress: (progress: PdfExtractionProgress) => void
	onPage: (page: PdfPageExtractionResult, nativePages: number, ocrPages: number) => void
}

function abortError() {
	return new DOMException('已取消文本提取', 'AbortError')
}

function throwIfAborted(signal: AbortSignal) {
	if (signal.aborted) throw abortError()
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.name === 'PasswordException') return '暂不支持加密 PDF，请先移除密码后重试'
	return error instanceof Error ? error.message : 'PDF 文本提取失败'
}

function isCjk(value: string) {
	return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(value)
}

function startsWithCjk(value: string) {
	return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value)
}

function needsSpace(previous: string, next: string) {
	if (!previous || !next || /\s$/.test(previous) || /^\s/.test(next)) return false
	return !isCjk(previous) && !startsWithCjk(next)
}

function normalizeTextItems(items: Array<TextItem | { type: string }>) {
	let text = ''
	let previous = ''

	for (const item of items) {
		if (!('str' in item)) continue
		if (needsSpace(previous, item.str)) text += ' '
		text += item.str

		if (item.hasEOL) {
			text += '\n'
			previous = ''
		} else {
			previous = item.str
		}
	}

	return text
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

function renderPage(page: PDFPageProxy, signal: AbortSignal, setRenderTask: (task: ReturnType<PDFPageProxy['render']> | null) => void) {
	const baseViewport = page.getViewport({ scale: 1 })
	const scale = Math.min(MAX_RENDER_SCALE, MAX_RENDER_SIDE / Math.max(baseViewport.width, baseViewport.height))
	const viewport = page.getViewport({ scale })
	const canvas = document.createElement('canvas')
	canvas.width = Math.max(1, Math.ceil(viewport.width))
	canvas.height = Math.max(1, Math.ceil(viewport.height))
	const width = canvas.width
	const height = canvas.height

	const renderTask = page.render({ canvas, viewport })
	setRenderTask(renderTask)

	return renderTask.promise
		.then(
			() =>
				new Promise<{ image: ArrayBuffer; width: number; height: number }>((resolve, reject) => {
					throwIfAborted(signal)
					canvas.toBlob(blob => {
						if (!blob) {
							reject(new Error('无法渲染 PDF 页面'))
							return
						}
						void blob.arrayBuffer().then(image => resolve({ image, width, height }), reject)
					}, 'image/png')
				})
		)
		.finally(() => {
			setRenderTask(null)
			canvas.width = 0
			canvas.height = 0
		})
}

function recognizePage(
	worker: Worker,
	image: ArrayBuffer,
	model: OcrModel,
	id: number,
	signal: AbortSignal,
	onStatus: (status: 'initializing' | 'recognizing') => void
) {
	return new Promise<OcrResult>((resolve, reject) => {
		const cleanup = () => {
			worker.removeEventListener('message', handleMessage)
			worker.removeEventListener('error', handleError)
			signal.removeEventListener('abort', handleAbort)
		}
		const handleMessage = (event: MessageEvent<OcrWorkerResponse>) => {
			const response = event.data
			if (response.id !== id) return

			if (response.type === 'status') {
				onStatus(response.status)
				return
			}

			cleanup()
			if (response.type === 'success') {
				resolve({ text: response.text, confidence: response.confidence, items: response.items })
			} else {
				reject(new Error(response.message))
			}
		}
		const handleError = (event: ErrorEvent) => {
			cleanup()
			reject(new Error(event.message || 'OCR Worker 运行异常'))
		}
		const handleAbort = () => {
			cleanup()
			reject(abortError())
		}

		worker.addEventListener('message', handleMessage)
		worker.addEventListener('error', handleError)
		signal.addEventListener('abort', handleAbort, { once: true })

		const request: OcrWorkerRequest = { id, type: 'recognize', model, image }
		worker.postMessage(request, [image])
	})
}

export function joinPdfPages(pages: Array<{ pageNumber: number; text: string }>) {
	if (pages.every(page => !page.text)) return ''
	if (pages.length === 1) return pages[0].text
	return pages.map(page => `===== 第 ${page.pageNumber} 页 =====\n${page.text}`.trimEnd()).join('\n\n')
}

export async function loadPdfJs() {
	pdfJsPromise ??= import('pdfjs-dist').then(pdfjs => {
		const assetBase = `${PDFJS_CDN}@${pdfjs.version}`
		pdfjs.GlobalWorkerOptions.workerSrc = `${assetBase}/build/pdf.worker.min.mjs`
		return pdfjs
	})
	return pdfJsPromise
}

export async function createPdfLoadingTask(file: File) {
	const pdfjs = await loadPdfJs()
	const assetBase = `${PDFJS_CDN}@${pdfjs.version}`
	const data = new Uint8Array(await file.arrayBuffer())
	return pdfjs.getDocument({
		data,
		cMapUrl: `${assetBase}/cmaps/`,
		cMapPacked: true,
		standardFontDataUrl: `${assetBase}/standard_fonts/`,
		wasmUrl: `${assetBase}/wasm/`
	})
}

export async function extractPdfText(documentProxy: PDFDocumentProxy, options: PdfExtractionOptions): Promise<PdfExtractionResult> {
	const { model, signal, initialResult, onProgress, onPage } = options
	let ocrWorker: Worker | null = null
	const active = { renderTask: null as ReturnType<PDFPageProxy['render']> | null }
	let ocrRequestId = 0

	const handleAbort = () => {
		active.renderTask?.cancel()
		ocrWorker?.terminate()
	}
	signal.addEventListener('abort', handleAbort, { once: true })

	try {
		throwIfAborted(signal)

		const pages = [...(initialResult?.pages ?? [])]
		let nativePages = initialResult?.nativePages ?? 0
		let ocrPages = initialResult?.ocrPages ?? 0

		for (let pageNumber = pages.length + 1; pageNumber <= documentProxy.numPages; pageNumber++) {
			throwIfAborted(signal)
			onProgress({ pageNumber, pageCount: documentProxy.numPages, stage: 'reading' })

			const page = await documentProxy.getPage(pageNumber)
			try {
				const content = await page.getTextContent()
				const nativeText = normalizeTextItems(content.items as Array<TextItem | { type: string }>)
				let pageText = nativeText
				let method: PdfPageExtractionResult['method'] = 'native'
				let confidence: number | null = null
				let items: OcrItem[] = []
				let imageWidth: number | null = null
				let imageHeight: number | null = null

				if (nativeText.replace(/\s/g, '').length >= MIN_NATIVE_TEXT_LENGTH) {
					nativePages += 1
				} else {
					onProgress({ pageNumber, pageCount: documentProxy.numPages, stage: 'rendering' })
					const renderedPage = await renderPage(page, signal, task => {
						active.renderTask = task
					})
					throwIfAborted(signal)

					ocrWorker ??= new Worker(new URL('./ocr/ocr.worker.ts', import.meta.url))
					const ocrResult = await recognizePage(ocrWorker, renderedPage.image, model, ++ocrRequestId, signal, status => {
						onProgress({
							pageNumber,
							pageCount: documentProxy!.numPages,
							stage: status === 'initializing' ? 'initializing-ocr' : 'ocr'
						})
					})
					pageText = ocrResult.text.trim() || nativeText
					method = 'ocr'
					confidence = ocrResult.confidence
					items = ocrResult.items
					imageWidth = renderedPage.width
					imageHeight = renderedPage.height
					ocrPages += 1
				}

				const pageResult: PdfPageExtractionResult = { pageNumber, text: pageText.trim(), method, confidence, items, imageWidth, imageHeight }
				pages.push(pageResult)
				onPage(pageResult, nativePages, ocrPages)
			} finally {
				page.cleanup()
			}
		}

		return {
			pages,
			nativePages,
			ocrPages
		}
	} catch (error) {
		if (signal.aborted || (error instanceof Error && error.name === 'AbortException')) throw abortError()
		throw new Error(getErrorMessage(error))
	} finally {
		signal.removeEventListener('abort', handleAbort)
		active.renderTask?.cancel()
		ocrWorker?.terminate()
	}
}
