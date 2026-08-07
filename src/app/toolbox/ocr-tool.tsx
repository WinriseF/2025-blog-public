'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCw, ScanText, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { SelectMenu } from '@/components/select-menu'
import { ImagePreviewDialog } from './image-preview-dialog'
import { OcrPreview, type OcrPreviewImage } from './ocr-preview'
import { OcrResultPanel } from './ocr-result-panel'
import { OcrUpload } from './ocr-upload'
import { useOcrWorker } from './use-ocr-worker'
import type { OcrModel } from '@/lib/ocr/types'

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const SUPPORTED_IMAGE_NAME = /\.(png|jpe?g|webp)$/i
const MODEL_OPTIONS: { value: OcrModel; label: string }[] = [
	{ value: 'tiny', label: 'PP-OCRv6 Tiny' },
	{ value: 'small', label: 'PP-OCRv6 Small' },
	{ value: 'medium', label: 'PP-OCRv6 Medium' }
]

function acceptsImage(file: File) {
	return SUPPORTED_IMAGE_TYPES.has(file.type) || (!file.type && SUPPORTED_IMAGE_NAME.test(file.name))
}

function isEditableTarget(target: EventTarget | null) {
	return target instanceof Element && target.closest('input, textarea, select, [contenteditable]') !== null
}

function disposeImage(image: OcrPreviewImage | null) {
	if (image) URL.revokeObjectURL(image.previewUrl)
}

export function OcrTool() {
	const shouldReduceMotion = useReducedMotion()
	const [image, setImage] = useState<OcrPreviewImage | null>(null)
	const [text, setText] = useState('')
	const [showBoxes, setShowBoxes] = useState(false)
	const [previewOpen, setPreviewOpen] = useState(false)
	const [model, setModel] = useState<OcrModel>('small')
	const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null)
	const [selectionRequest, setSelectionRequest] = useState(0)
	const imageRef = useRef<OcrPreviewImage | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const { phase, result, error, errorPhase, recognize, cancel, reset, restart } = useOcrWorker()
	const busy = phase === 'initializing' || phase === 'recognizing'

	const loadImage = useCallback(
		async (file: File) => {
			if (!acceptsImage(file)) {
				toast.error('暂只支持 PNG、JPG、JPEG、WEBP 图片')
				return
			}

			try {
				const bitmap = await createImageBitmap(file)
				const nextImage: OcrPreviewImage = {
					file,
					name: file.name || 'clipboard-image.png',
					previewUrl: URL.createObjectURL(file),
					width: bitmap.width,
					height: bitmap.height
				}
				bitmap.close()

				reset()
				disposeImage(imageRef.current)
				imageRef.current = nextImage
				setImage(nextImage)
				setText('')
				setShowBoxes(false)
				setPreviewOpen(false)
				setSelectedItemIndex(null)
			} catch (loadError) {
				console.error(loadError)
				toast.error('图片读取失败，请换一张图片试试')
			}
		},
		[reset]
	)

	useEffect(() => {
		const handlePaste = (event: ClipboardEvent) => {
			if (isEditableTarget(event.target)) return
			const item = Array.from(event.clipboardData?.items ?? []).find(candidate => candidate.type.startsWith('image/'))
			const file = item?.getAsFile()
			if (!file) return
			event.preventDefault()
			void loadImage(file)
		}

		window.addEventListener('paste', handlePaste)
		return () => window.removeEventListener('paste', handlePaste)
	}, [loadImage])

	useEffect(() => {
		if (phase !== 'success' || !result) return
		setText(result.text)
		setShowBoxes(result.items.length > 0)
	}, [phase, result])

	useEffect(() => {
		return () => disposeImage(imageRef.current)
	}, [])

	const handleRecognize = useCallback(() => {
		if (!image || busy) return
		setText('')
		setShowBoxes(false)
		setSelectedItemIndex(null)
		void recognize(image.file, model)
	}, [busy, image, model, recognize])

	const handleSelectItem = useCallback((index: number | null) => {
		setSelectedItemIndex(index)
		if (index !== null) setSelectionRequest(current => current + 1)
	}, [])

	const handleShowBoxesChange = useCallback((show: boolean) => {
		setShowBoxes(show)
		if (!show) setSelectedItemIndex(null)
	}, [])

	const handleClear = useCallback(() => {
		reset()
		disposeImage(imageRef.current)
		imageRef.current = null
		setImage(null)
		setText('')
		setShowBoxes(false)
		setPreviewOpen(false)
		setSelectedItemIndex(null)
	}, [reset])

	const handleModelChange = useCallback(
		(nextModel: OcrModel) => {
			if (nextModel === model) return
			restart()
			setModel(nextModel)
			setText('')
			setShowBoxes(false)
			setSelectedItemIndex(null)
		},
		[model, restart]
	)

	const statusText = (() => {
		if (phase === 'initializing') return `正在准备 ${MODEL_OPTIONS.find(option => option.value === model)?.label ?? 'OCR 模型'}`
		if (phase === 'recognizing') return '正在识别'
		if (phase === 'success') return result?.items.length ? `识别完成，共 ${result.items.length} 个文字区域` : '识别完成，未发现文字'
		if (phase === 'error') return `${errorPhase === 'initialize' ? '模型初始化失败' : '识别失败'}：${error ?? '未知错误'}`
		return '图片已就绪'
	})()

	const primaryLabel = phase === 'success' ? '重新识别' : phase === 'error' ? '重试' : '开始识别'
	const primaryIcon = phase === 'success' || phase === 'error' ? <RotateCw size={17} /> : <ScanText size={17} />
	const transition = shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }

	return (
		<motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={transition} className='mx-auto flex max-w-6xl flex-col gap-6'>
			<input
				ref={fileInputRef}
				type='file'
				accept='image/png,image/jpeg,image/jpg,image/webp'
				className='hidden'
				onChange={event => {
					const file = event.currentTarget.files?.[0]
					if (file) void loadImage(file)
					event.currentTarget.value = ''
				}}
			/>

			<header className='flex flex-wrap items-start justify-between gap-4'>
				<div>
					<h1 className='text-2xl font-semibold tracking-normal text-primary'>图片文字识别</h1>
					<p className='mt-3 text-sm text-secondary'>浏览器本地处理，图片不会上传</p>
				</div>
				<SelectMenu
					value={model}
					options={MODEL_OPTIONS}
					onChange={handleModelChange}
					ariaLabel='选择识别模型'
					label='识别模型'
					leading={<ScanText size={16} className='text-brand' />}
					disabled={busy}
					className='max-sm:w-full'
				/>
			</header>

			<AnimatePresence mode='wait' initial={false}>
				{image ? (
					<motion.div
						key='workspace'
						initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={transition}
						className='overflow-hidden rounded-lg border border-border bg-background/20'>
						<div className='grid min-w-0 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]'>
							<div className='flex min-w-0 flex-col'>
								<OcrPreview
									image={image}
									items={result?.items ?? []}
									showBoxes={showBoxes}
									selectedItemIndex={selectedItemIndex}
									onShowBoxesChange={handleShowBoxesChange}
									onSelectItem={handleSelectItem}
									onOpenPreview={() => setPreviewOpen(true)}
									onReplace={() => fileInputRef.current?.click()}
									onClear={handleClear}
								/>

								<div className='flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 max-sm:items-stretch max-sm:px-3'>
									<div className='min-w-0 flex-1' aria-live='polite' aria-atomic='true'>
										<AnimatePresence mode='wait' initial={false}>
											<motion.p
												key={phase}
												initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
												animate={{ opacity: 1, y: 0 }}
												exit={{ opacity: 0 }}
												transition={transition}
												className={`break-words text-sm ${phase === 'error' ? 'text-red-500' : 'text-secondary'}`}>
												{statusText}
											</motion.p>
										</AnimatePresence>
										{phase === 'initializing' && (
											<div role='progressbar' aria-label='模型加载中' aria-valuetext='正在加载模型' className='mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-border/70'>
												<motion.span
													className='block h-full w-2/5 rounded-full bg-brand'
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
													className='flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-lg bg-brand px-5 font-semibold text-background opacity-75 max-sm:flex-1'>
													<LoaderCircle size={17} className='motion-safe:animate-spin' />
													{phase === 'initializing' ? '正在准备模型' : '正在识别'}
												</button>
											<motion.button
												type='button'
												onClick={cancel}
													whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
													className='flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background/40 px-4 font-medium text-primary outline-none transition-colors duration-150 hover:border-brand/45 focus-visible:ring-2 focus-visible:ring-brand max-sm:flex-1'>
													<X size={17} />
													取消
												</motion.button>
											</>
										) : (
											<motion.button
												type='button'
												onClick={handleRecognize}
												whileHover={shouldReduceMotion ? undefined : { y: -1 }}
												whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
												className='flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-lg bg-brand px-5 font-semibold text-background outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background max-sm:w-full'>
												{primaryIcon}
												{primaryLabel}
											</motion.button>
										)}
									</div>
								</div>
							</div>

							<OcrResultPanel
								phase={phase}
								result={result}
								text={text}
								fileName={image.name}
								selectedItemIndex={selectedItemIndex}
								selectionRequest={selectionRequest}
								onTextChange={setText}
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
						<OcrUpload onFile={file => void loadImage(file)} />
					</motion.div>
				)}
			</AnimatePresence>

			{image && previewOpen && <ImagePreviewDialog src={image.previewUrl} alt={image.name} onClose={() => setPreviewOpen(false)} />}
		</motion.div>
	)
}
