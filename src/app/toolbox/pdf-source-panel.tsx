'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileUp, LoaderCircle, Trash2 } from 'lucide-react'
import { createPdfLoadingTask, type PdfExtractionResult } from '@/lib/pdf-text-extractor'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import { OcrBoxes } from './ocr-preview'

type PdfSourcePanelProps = {
	file: File
	pageNumber: number
	pageCount: number
	busy: boolean
	result: PdfExtractionResult | null
	showBoxes: boolean
	selectedItemIndex: number | null
	onPageChange: (pageNumber: number) => void
	onShowBoxesChange: (show: boolean) => void
	onSelectItem: (index: number | null) => void
	onDocumentChange: (documentProxy: PDFDocumentProxy | null) => void
	onReplace: () => void
	onClear: () => void
}

function formatBytes(bytes: number) {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getPreviewError(error: unknown) {
	if (error instanceof Error && error.name === 'PasswordException') return '暂不支持预览加密 PDF'
	return error instanceof Error ? error.message : 'PDF 页面预览失败'
}

export function PdfSourcePanel({
	file,
	pageNumber,
	pageCount,
	busy,
	result,
	showBoxes,
	selectedItemIndex,
	onPageChange,
	onShowBoxesChange,
	onSelectItem,
	onDocumentChange,
	onReplace,
	onClear
}: PdfSourcePanelProps) {
	const hostRef = useRef<HTMLDivElement | null>(null)
	const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
	const documentRef = useRef<PDFDocumentProxy | null>(null)
	const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null)
	const [documentReady, setDocumentReady] = useState(false)
	const [rendering, setRendering] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const currentPageResult = result?.pages[pageNumber - 1] ?? null
	const items = currentPageResult?.items ?? []
	const visiblePageCount = pageCount
	const navigationPageCount = busy ? Math.max(1, result?.pages.length ?? 0) : visiblePageCount

	useEffect(() => {
		let disposed = false
		setDocumentReady(false)
		setRendering(false)
		setError(null)
		documentRef.current = null
		onDocumentChange(null)
		hostRef.current?.replaceChildren()

		void createPdfLoadingTask(file)
			.then(loadingTask => {
				if (disposed) {
					void loadingTask.destroy()
					return null
				}
				loadingTaskRef.current = loadingTask
				return loadingTask.promise
			})
			.then(documentProxy => {
				if (!documentProxy || disposed) return
				documentRef.current = documentProxy
				onDocumentChange(documentProxy)
				setDocumentReady(true)
			})
			.catch(loadError => {
				if (!disposed) setError(getPreviewError(loadError))
			})

		return () => {
			disposed = true
			renderTaskRef.current?.cancel()
			renderTaskRef.current = null
			documentRef.current = null
			onDocumentChange(null)
			const loadingTask = loadingTaskRef.current
			loadingTaskRef.current = null
			if (loadingTask) void loadingTask.destroy()
		}
	}, [file, onDocumentChange])

	useEffect(() => {
		const documentProxy = documentRef.current
		const host = hostRef.current
		if (!documentReady || !documentProxy || !host || !visiblePageCount) return

		let disposed = false
		let page: PDFPageProxy | null = null
		let renderTask: ReturnType<PDFPageProxy['render']> | null = null
		setRendering(true)
		setError(null)

		void documentProxy
			.getPage(Math.min(Math.max(pageNumber, 1), documentProxy.numPages))
			.then(nextPage => {
				page = nextPage
				const baseViewport = nextPage.getViewport({ scale: 1 })
				const cssScale = Math.min(1.5, 1400 / Math.max(baseViewport.width, baseViewport.height))
				const outputScale = Math.min(window.devicePixelRatio || 1, 2)
				const viewport = nextPage.getViewport({ scale: cssScale * outputScale })
				const canvas = document.createElement('canvas')
				canvas.width = Math.max(1, Math.ceil(viewport.width))
				canvas.height = Math.max(1, Math.ceil(viewport.height))
				canvas.style.width = `${viewport.width / outputScale}px`
				canvas.style.height = 'auto'
				canvas.className = 'block h-auto max-w-full rounded-sm bg-white shadow-sm'

				renderTask = nextPage.render({ canvas, viewport })
				renderTaskRef.current = renderTask
				return renderTask.promise.then(() => canvas)
			})
			.then(canvas => {
				if (disposed) return
				host.replaceChildren(canvas)
				setRendering(false)
			})
			.catch(renderError => {
				if (disposed || (renderError instanceof Error && renderError.name === 'RenderingCancelledException')) return
				setRendering(false)
				setError(getPreviewError(renderError))
			})
			.finally(() => {
				page?.cleanup()
				if (renderTaskRef.current === renderTask) renderTaskRef.current = null
			})

		return () => {
			disposed = true
			renderTask?.cancel()
		}
	}, [documentReady, pageNumber, visiblePageCount])

	const goToPage = (nextPage: number) => {
		if (!navigationPageCount) return
		onPageChange(Math.min(Math.max(nextPage, 1), navigationPageCount))
	}

	return (
		<section className='flex min-w-0 flex-col'>
			<div className='border-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 max-sm:px-3'>
				<div className='min-w-0 flex-1'>
					<p className='text-primary truncate text-sm font-semibold' title={file.name}>
						{file.name}
					</p>
					<p className='text-secondary mt-1 text-xs'>{formatBytes(file.size)}</p>
				</div>

				<div className='flex items-center gap-1.5'>
					<button
						type='button'
						onClick={() => goToPage(pageNumber - 1)}
						disabled={pageNumber <= 1}
						aria-label='上一页'
						title='上一页'
						className='border-border bg-background/35 text-primary hover:border-brand/45 focus-visible:ring-brand disabled:text-secondary/35 flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 disabled:cursor-not-allowed'>
						<ChevronLeft size={17} />
					</button>
					<span className='text-secondary min-w-16 text-center text-xs tabular-nums' aria-live='polite'>
						{visiblePageCount ? `${pageNumber} / ${visiblePageCount}` : '— / —'}
					</span>
					<button
						type='button'
						onClick={() => goToPage(pageNumber + 1)}
						disabled={!navigationPageCount || pageNumber >= navigationPageCount}
						aria-label='下一页'
						title='下一页'
						className='border-border bg-background/35 text-primary hover:border-brand/45 focus-visible:ring-brand disabled:text-secondary/35 flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 disabled:cursor-not-allowed'>
						<ChevronRight size={17} />
					</button>
				</div>

				<div className='flex items-center gap-2'>
					<label
						className={`flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors ${
							items.length ? 'text-primary hover:bg-brand/5 cursor-pointer' : 'text-secondary/45 cursor-not-allowed'
						}`}>
						<input
							type='checkbox'
							checked={showBoxes && items.length > 0}
							disabled={!items.length}
							onChange={event => onShowBoxesChange(event.currentTarget.checked)}
							className='border-border bg-card focus-visible:outline-brand size-4 rounded accent-[var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2'
						/>
						显示识别框
					</label>
					<button
						type='button'
						onClick={onReplace}
						className='border-border bg-background/35 text-primary hover:border-brand/45 focus-visible:ring-brand flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2'
						aria-label='替换文件'
						title='替换文件'>
						<FileUp size={16} />
					</button>
					<button
						type='button'
						onClick={onClear}
						className='border-border bg-background/35 text-secondary hover:border-brand/45 hover:text-primary focus-visible:ring-brand flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2'
						aria-label='清除文件'
						title='清除文件'>
						<Trash2 size={16} />
					</button>
				</div>
			</div>

			<div className='bg-card/25 relative flex max-h-[72vh] min-h-[410px] items-start justify-center overflow-auto p-5 max-sm:min-h-[320px] max-sm:p-3'>
				<div onClick={() => onSelectItem(null)} className='relative block w-fit max-w-full'>
					<div ref={hostRef} />
					{showBoxes && items.length > 0 && currentPageResult?.imageWidth && currentPageResult.imageHeight && (
						<OcrBoxes
							items={items}
							width={currentPageResult.imageWidth}
							height={currentPageResult.imageHeight}
							selectedItemIndex={selectedItemIndex}
							onSelectItem={onSelectItem}
						/>
					)}
				</div>

				{(rendering || !documentReady) && !error && (
					<div className='bg-card/70 text-secondary absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur-[2px]'>
						<LoaderCircle size={24} className='text-brand motion-safe:animate-spin' />
						<span className='text-sm'>{documentReady ? `正在渲染第 ${pageNumber} 页` : '正在载入 PDF 预览'}</span>
					</div>
				)}

				{error && <div className='text-secondary absolute inset-0 flex items-center justify-center p-6 text-center text-sm'>{error}</div>}

			</div>
		</section>
	)
}
