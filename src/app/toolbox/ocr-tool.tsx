'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCw, ScanText, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { SelectMenu } from '@/components/select-menu'
import { extractPdfText, joinPdfPages, type PdfExtractionProgress, type PdfExtractionResult } from '@/lib/pdf-text-extractor'
import type { OcrModel, OcrResult } from '@/lib/ocr/types'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import { OcrPreview, type OcrPreviewImage } from './ocr-preview'
import { OcrResultPanel } from './ocr-result-panel'
import { OcrUpload } from './ocr-upload'
import { PdfSourcePanel } from './pdf-source-panel'
import { useOcrWorker, type OcrPhase } from './use-ocr-worker'

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const SUPPORTED_IMAGE_NAME = /\.(png|jpe?g|webp)$/i
const PDF_NAME = /\.pdf$/i
const MODEL_OPTIONS: { value: OcrModel; label: string }[] = [
	{ value: 'tiny', label: 'PP-OCRv6 Tiny' },
	{ value: 'small', label: 'PP-OCRv6 Small' },
	{ value: 'medium', label: 'PP-OCRv6 Medium' }
]

type TextSource = { kind: 'image'; image: OcrPreviewImage } | { kind: 'pdf'; file: File }

type PdfState = {
	phase: OcrPhase
	progress: PdfExtractionProgress | null
	result: PdfExtractionResult | null
	error: string | null
}

const INITIAL_PDF_STATE: PdfState = {
	phase: 'idle',
	progress: null,
	result: null,
	error: null
}

function acceptsImage(file: File) {
	return SUPPORTED_IMAGE_TYPES.has(file.type) || (!file.type && SUPPORTED_IMAGE_NAME.test(file.name))
}

function acceptsPdf(file: File) {
	return file.type === 'application/pdf' || PDF_NAME.test(file.name)
}

function isEditableTarget(target: EventTarget | null) {
	return target instanceof Element && target.closest('input, textarea, select, [contenteditable]') !== null
}

function disposeImage(image: OcrPreviewImage | null) {
	if (image) URL.revokeObjectURL(image.previewUrl)
}

function pdfStatusText(state: PdfState) {
	const progress = state.progress
	if (state.phase === 'recognizing' && progress) {
		const page = progress.pageCount ? `第 ${progress.pageNumber} / ${progress.pageCount} 页` : 'PDF 文档'
		if (progress.stage === 'reading') return `正在读取${page}文本层`
		if (progress.stage === 'rendering') return `${page}需要识别，正在渲染`
		if (progress.stage === 'initializing-ocr') return `${page}正在准备 OCR 模型`
		if (progress.stage === 'ocr') return `${page}正在识别`
		return '正在读取 PDF'
	}
	if (state.phase === 'success' && state.result) {
		const { pages, nativePages, ocrPages } = state.result
		return `提取完成，共 ${pages.length} 页（文本 ${nativePages} 页，扫描 ${ocrPages} 页）`
	}
	if (state.phase === 'error') {
		const completed = state.result?.pages.length ?? 0
		return `提取失败：${state.error ?? '未知错误'}${completed ? `，已保留前 ${completed} 页` : ''}`
	}
	return 'PDF 已就绪'
}

export function OcrTool() {
	const shouldReduceMotion = useReducedMotion()
	const [source, setSource] = useState<TextSource | null>(null)
	const [text, setText] = useState('')
	const [showBoxes, setShowBoxes] = useState(false)
	const [previewOpen, setPreviewOpen] = useState(false)
	const [model, setModel] = useState<OcrModel>('small')
	const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null)
	const [selectionRequest, setSelectionRequest] = useState(0)
	const [pdfState, setPdfState] = useState<PdfState>(INITIAL_PDF_STATE)
	const [pdfPageNumber, setPdfPageNumber] = useState(1)
	const [pdfPageCount, setPdfPageCount] = useState(0)
	const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
	const imageRef = useRef<OcrPreviewImage | null>(null)
	const pdfAbortRef = useRef<AbortController | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const { phase, result, error, errorPhase, recognize, cancel, reset, restart } = useOcrWorker()
	const activePhase = source?.kind === 'pdf' ? pdfState.phase : phase
	const busy = activePhase === 'initializing' || activePhase === 'recognizing'

	const abortPdf = useCallback(() => {
		pdfAbortRef.current?.abort()
		pdfAbortRef.current = null
	}, [])

	const loadFile = useCallback(
		async (file: File) => {
			const pdf = acceptsPdf(file)
			if (!pdf && !acceptsImage(file)) {
				toast.error('暂只支持 PNG、JPG、JPEG、WEBP 图片和 PDF 文档')
				return
			}

			abortPdf()
			if (pdf) restart()
			else reset()
			setPdfState(INITIAL_PDF_STATE)
			setPdfPageNumber(1)
			setPdfPageCount(0)
			setPdfDocument(null)
			disposeImage(imageRef.current)
			imageRef.current = null
			setSource(null)
			setText('')
			setShowBoxes(false)
			setPreviewOpen(false)
			setSelectedItemIndex(null)

			if (pdf) {
				setSource({ kind: 'pdf', file })
				return
			}

			try {
				const bitmap = await createImageBitmap(file)
				const image: OcrPreviewImage = {
					file,
					name: file.name || 'clipboard-image.png',
					previewUrl: URL.createObjectURL(file),
					width: bitmap.width,
					height: bitmap.height
				}
				bitmap.close()
				imageRef.current = image
				setSource({ kind: 'image', image })
			} catch (loadError) {
				console.error(loadError)
				toast.error('图片读取失败，请换一张图片试试')
			}
		},
		[abortPdf, reset, restart]
	)

	useEffect(() => {
		const handlePaste = (event: ClipboardEvent) => {
			if (isEditableTarget(event.target)) return
			const item = Array.from(event.clipboardData?.items ?? []).find(candidate => candidate.type.startsWith('image/'))
			const file = item?.getAsFile()
			if (!file) return
			event.preventDefault()
			void loadFile(file)
		}

		window.addEventListener('paste', handlePaste)
		return () => window.removeEventListener('paste', handlePaste)
	}, [loadFile])

	useEffect(() => {
		if (source?.kind !== 'image' || phase !== 'success' || !result) return
		setText(result.text)
		setShowBoxes(result.items.length > 0)
	}, [phase, result, source?.kind])

	useEffect(() => {
		return () => {
			abortPdf()
			disposeImage(imageRef.current)
		}
	}, [abortPdf])

	const handleExtract = useCallback(() => {
		if (!source || busy) return

		if (source.kind === 'image') {
			setText('')
			setShowBoxes(false)
			setSelectedItemIndex(null)
			void recognize(source.image.file, model)
			return
		}
		if (!pdfDocument) return
		const initialResult = pdfState.phase === 'error' ? pdfState.result : null
		const controller = new AbortController()
		pdfAbortRef.current = controller
		if (!initialResult) {
			setPdfPageNumber(1)
			setShowBoxes(true)
		}
		setPdfState({ phase: 'recognizing', progress: null, result: initialResult, error: null })

		void extractPdfText(pdfDocument, {
			model,
			signal: controller.signal,
			initialResult,
			onProgress: progress => {
				if (pdfAbortRef.current !== controller) return
				setPdfState(current => ({ ...current, progress }))
			},
			onPage: (page, nativePages, ocrPages) => {
				if (pdfAbortRef.current !== controller) return
				setPdfState(current => ({
					...current,
					result: {
						pages: [...(current.result?.pages ?? []), page],
						nativePages,
						ocrPages
					}
				}))
			}
		})
			.then(pdfResult => {
				if (pdfAbortRef.current !== controller) return
				setPdfState({ phase: 'success', progress: null, result: pdfResult, error: null })
			})
			.catch(pdfError => {
				if (pdfAbortRef.current !== controller || controller.signal.aborted) return
				setPdfState(current => ({
					...current,
					phase: 'error',
					progress: null,
					error: pdfError instanceof Error ? pdfError.message : 'PDF 文本提取失败'
				}))
			})
			.finally(() => {
				if (pdfAbortRef.current === controller) pdfAbortRef.current = null
			})
	}, [busy, model, pdfDocument, pdfState.phase, pdfState.result, recognize, source])

	const handleSelectItem = useCallback((index: number | null) => {
		setSelectedItemIndex(index)
		if (index !== null) setSelectionRequest(current => current + 1)
	}, [])

	const handleShowBoxesChange = useCallback((show: boolean) => {
		setShowBoxes(show)
		if (!show) setSelectedItemIndex(null)
	}, [])

	const handleClear = useCallback(() => {
		abortPdf()
		reset()
		disposeImage(imageRef.current)
		imageRef.current = null
		setSource(null)
		setPdfState(INITIAL_PDF_STATE)
		setPdfPageNumber(1)
		setPdfPageCount(0)
		setPdfDocument(null)
		setText('')
		setShowBoxes(false)
		setPreviewOpen(false)
		setSelectedItemIndex(null)
	}, [abortPdf, reset])

	const handlePdfDocumentChange = useCallback((documentProxy: PDFDocumentProxy | null) => {
		setPdfDocument(documentProxy)
		if (!documentProxy) return
		setPdfPageCount(documentProxy.numPages)
		setPdfPageNumber(current => Math.min(Math.max(current, 1), Math.max(documentProxy.numPages, 1)))
	}, [])

	const handlePdfPageChange = useCallback((pageNumber: number) => {
		setPdfPageNumber(pageNumber)
		setSelectedItemIndex(null)
	}, [])

	const handleTextChange = useCallback(
		(nextText: string) => {
			if (source?.kind !== 'pdf') {
				setText(nextText)
				return
			}

			setPdfState(current => {
				if (!current.result) return current
				const pages = current.result.pages.map(page => (page.pageNumber === pdfPageNumber ? { ...page, text: nextText } : page))
				return {
					...current,
					result: {
						...current.result,
						pages
					}
				}
			})
		},
		[pdfPageNumber, source?.kind]
	)

	const handleCancel = useCallback(() => {
		if (source?.kind === 'pdf') {
			abortPdf()
			setPdfState(INITIAL_PDF_STATE)
			setText('')
			return
		}
		cancel()
	}, [abortPdf, cancel, source?.kind])

	const handleModelChange = useCallback(
		(nextModel: OcrModel) => {
			if (nextModel === model) return
			abortPdf()
			restart()
			setModel(nextModel)
			setPdfState(INITIAL_PDF_STATE)
			setText('')
			setShowBoxes(false)
			setSelectedItemIndex(null)
		},
		[abortPdf, model, restart]
	)

	const imageStatusText = (() => {
		if (phase === 'initializing') return `正在准备 ${MODEL_OPTIONS.find(option => option.value === model)?.label ?? 'OCR 模型'}`
		if (phase === 'recognizing') return '正在提取图片文字'
		if (phase === 'success') return result?.items.length ? `提取完成，共 ${result.items.length} 个文字区域` : '提取完成，未发现文字'
		if (phase === 'error') return `${errorPhase === 'initialize' ? '模型初始化失败' : '提取失败'}：${error ?? '未知错误'}`
		return '图片已就绪'
	})()
	const statusText = source?.kind === 'pdf' ? pdfStatusText(pdfState) : imageStatusText
	const primaryLabel = activePhase === 'success' ? '重新提取' : activePhase === 'error' ? (source?.kind === 'pdf' && pdfState.result?.pages.length ? '继续提取' : '重试') : '开始提取'
	const primaryIcon = activePhase === 'success' || activePhase === 'error' ? <RotateCw size={17} /> : <ScanText size={17} />
	const transition = shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }
	const currentPdfPage = source?.kind === 'pdf' ? (pdfState.result?.pages[pdfPageNumber - 1] ?? null) : null
	const panelText = source?.kind === 'pdf' ? (currentPdfPage?.text ?? '') : text
	const panelResult: OcrResult | null =
		source?.kind === 'pdf' ? (currentPdfPage ? { text: currentPdfPage.text, confidence: currentPdfPage.confidence ?? 0, items: currentPdfPage.items } : null) : result
	const pdfSubtitle = currentPdfPage
		? `第 ${pdfPageNumber} / ${pdfPageCount} 页 · ${currentPdfPage.method === 'native' ? '文本层' : `OCR · 置信度 ${Math.round((currentPdfPage.confidence ?? 0) * 100)}%`}`
		: pdfPageCount
			? `第 ${pdfPageNumber} / ${pdfPageCount} 页`
			: undefined
	const downloadText = source?.kind === 'pdf' && pdfState.result ? joinPdfPages(pdfState.result.pages) : undefined

	return (
		<motion.div
			initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={transition}
			className='mx-auto flex max-w-6xl flex-col gap-6'>
			<input
				ref={fileInputRef}
				type='file'
				accept='image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf'
				className='hidden'
				onChange={event => {
					const file = event.currentTarget.files?.[0]
					if (file) void loadFile(file)
					event.currentTarget.value = ''
				}}
			/>

			<header className='flex flex-wrap items-start justify-between gap-4'>
				<div>
					<h1 className='text-primary text-2xl font-semibold tracking-normal'>文本提取</h1>
					<p className='text-secondary mt-3 text-sm'>浏览器本地处理，文件不会上传</p>
				</div>
				<SelectMenu
					value={model}
					options={MODEL_OPTIONS}
					onChange={handleModelChange}
					ariaLabel='选择识别模型'
					label={source?.kind === 'pdf' ? '扫描页模型' : '识别模型'}
					leading={<ScanText size={16} className='text-brand' />}
					disabled={busy}
					className='max-sm:w-full'
				/>
			</header>

			<AnimatePresence mode='wait' initial={false}>
				{source ? (
					<motion.div
						key='workspace'
						initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={transition}
						className='border-border bg-background/20 overflow-hidden rounded-lg border'>
						<div className='grid min-w-0 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]'>
							<div className='flex min-w-0 flex-col'>
								{source.kind === 'image' ? (
									<OcrPreview
										image={source.image}
										items={result?.items ?? []}
										showBoxes={showBoxes}
										selectedItemIndex={selectedItemIndex}
										onShowBoxesChange={handleShowBoxesChange}
										onSelectItem={handleSelectItem}
										onOpenPreview={() => setPreviewOpen(true)}
										onReplace={() => fileInputRef.current?.click()}
										onClear={handleClear}
									/>
								) : (
									<PdfSourcePanel
										file={source.file}
										pageNumber={pdfPageNumber}
										pageCount={pdfPageCount}
										busy={busy}
										result={pdfState.result}
										showBoxes={showBoxes}
										selectedItemIndex={selectedItemIndex}
										onPageChange={handlePdfPageChange}
										onShowBoxesChange={handleShowBoxesChange}
										onSelectItem={handleSelectItem}
										onDocumentChange={handlePdfDocumentChange}
										onReplace={() => fileInputRef.current?.click()}
										onClear={handleClear}
									/>
								)}

								<div className='border-border flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-t px-4 py-3 max-sm:items-stretch max-sm:px-3'>
									<div className='min-w-0 flex-1' aria-live='polite' aria-atomic='true'>
										<AnimatePresence mode='wait' initial={false}>
											<motion.p
												key={activePhase}
												initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
												animate={{ opacity: 1, y: 0 }}
												exit={{ opacity: 0 }}
												transition={transition}
												className={`text-sm break-words ${activePhase === 'error' ? 'text-red-500' : 'text-secondary'}`}>
												{statusText}
											</motion.p>
										</AnimatePresence>
										{activePhase === 'initializing' && (
											<div
												role='progressbar'
												aria-label='解析器加载中'
												aria-valuetext='正在准备文本提取'
												className='bg-border/70 mt-2 h-1.5 max-w-sm overflow-hidden rounded-full'>
												<motion.span
													className='bg-brand block h-full w-2/5 rounded-full'
													initial={false}
													animate={shouldReduceMotion ? { x: '0%' } : { x: ['-110%', '260%'] }}
													transition={shouldReduceMotion ? { duration: 0 } : { duration: 1.15, ease: 'easeInOut', repeat: Infinity }}
												/>
											</div>
										)}
									</div>
									<div className='flex items-center gap-2 max-sm:w-full'>
										{busy ? (
											<>
												<button
													type='button'
													disabled
													className='bg-brand text-background flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-lg px-5 font-semibold opacity-75 max-sm:flex-1'>
													<LoaderCircle size={17} className='motion-safe:animate-spin' />
													{activePhase === 'initializing' ? '正在准备' : '正在提取'}
												</button>
												<motion.button
													type='button'
													onClick={handleCancel}
													whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
													className='border-border bg-background/40 text-primary hover:border-brand/45 focus-visible:ring-brand flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 font-medium transition-colors duration-150 outline-none focus-visible:ring-2 max-sm:flex-1'>
													<X size={17} />
													取消
												</motion.button>
											</>
										) : (
											<motion.button
												type='button'
												onClick={handleExtract}
												disabled={source.kind === 'pdf' && !pdfDocument}
												whileHover={shouldReduceMotion ? undefined : { y: -1 }}
												whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
												className='bg-brand text-background focus-visible:ring-brand focus-visible:ring-offset-background flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-lg px-5 font-semibold transition-opacity duration-150 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 max-sm:w-full'>
												{primaryIcon}
												{primaryLabel}
											</motion.button>
										)}
									</div>
								</div>
							</div>

							<OcrResultPanel
								phase={activePhase}
								result={panelResult}
								text={panelText}
								fileName={source.kind === 'image' ? source.image.name : source.file.name}
								showConfidence={source.kind === 'image'}
								subtitle={source.kind === 'pdf' ? pdfSubtitle : undefined}
								downloadText={downloadText}
								downloadTitle={source.kind === 'pdf' ? '下载全部页面 TXT' : undefined}
								downloadEnabled={source.kind === 'image' || activePhase === 'success'}
								emptyMessage={source.kind === 'pdf' ? '本页未提取到文字，可以直接补充或重新提取。' : undefined}
								selectedItemIndex={selectedItemIndex}
								selectionRequest={selectionRequest}
								onTextChange={handleTextChange}
							/>
						</div>
					</motion.div>
				) : (
					<motion.div
						key='upload'
						initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={transition}>
						<OcrUpload onFile={file => void loadFile(file)} />
					</motion.div>
				)}
			</AnimatePresence>

			{source?.kind === 'image' && previewOpen && (
				<ImagePreviewDialog src={source.image.previewUrl} alt={source.image.name} onClose={() => setPreviewOpen(false)} />
			)}
		</motion.div>
	)
}
