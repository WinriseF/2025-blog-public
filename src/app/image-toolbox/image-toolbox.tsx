'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import { DialogModal } from '@/components/dialog-modal'
import { OptimizedImage } from '@/components/optimized-image'

type ConvertedMeta = {
	url: string
	size: number
}

type SelectedImage = {
	file: File
	preview: string
	width: number
	height: number
	converted?: ConvertedMeta
	converting?: boolean
}

type ImageToolboxProps = {
	embedded?: boolean
}

const MAX_NAME_LENGTH = 32

function getFileExtension(name: string) {
	const idx = name.lastIndexOf('.')
	return idx >= 0 ? name.slice(idx) : ''
}

function formatFileName(name: string) {
	if (name.length <= MAX_NAME_LENGTH) return name
	const ext = getFileExtension(name)
	if (!ext) {
		return `${name.slice(0, MAX_NAME_LENGTH - 3)}...`
	}
	const maxBaseLength = Math.max(1, MAX_NAME_LENGTH - ext.length - 3)
	return `${name.slice(0, maxBaseLength)}...${ext}`
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes.toFixed(0)} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function fileToWebp(file: File, quality: number, maxWidth?: number) {
	const bitmap = await createImageBitmap(file)
	try {
		const canvas = document.createElement('canvas')

		let width = bitmap.width
		let height = bitmap.height

		if (maxWidth && width > maxWidth) {
			const ratio = maxWidth / width
			width = maxWidth
			height = Math.round(height * ratio)
		}

		canvas.width = width
		canvas.height = height
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('无法初始化画布')
		ctx.drawImage(bitmap, 0, 0, width, height)
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				result => {
					if (result) resolve(result)
					else reject(new Error('无法生成 WEBP 文件'))
				},
				'image/webp',
				quality
			)
		})
	} finally {
		bitmap.close()
	}
}

export function ImageToolbox({ embedded = false }: ImageToolboxProps = {}) {
	const [images, setImages] = useState<SelectedImage[]>([])
	const [quality, setQuality] = useState(0.8)
	const [limitMaxWidth, setLimitMaxWidth] = useState(false)
	const [maxWidth, setMaxWidth] = useState(1200)
	const [batchConverting, setBatchConverting] = useState(false)
	const [compareIndex, setCompareIndex] = useState<number | null>(null)
	const [isDragging, setIsDragging] = useState(false)
	const hasImages = images.length > 0
	const hasConvertible = images.length > 0
	const hasConverted = images.some(item => !!item.converted)
	const imagesRef = useRef<SelectedImage[]>([])
	const dragCounterRef = useRef(0)

	useEffect(() => {
		imagesRef.current = images
	}, [images])

	const handleFiles = useCallback(async (fileList: FileList | null) => {
		if (!fileList?.length) return
		const files = Array.from(fileList).filter(file => file.type.startsWith('image/'))
		if (!files.length) return

		const nextItems = await Promise.all(
			files.map(async file => {
				const bitmap = await createImageBitmap(file)
				const width = bitmap.width
				const height = bitmap.height
				bitmap.close()
				return {
					file,
					preview: URL.createObjectURL(file),
					width,
					height
				}
			})
		)

		setImages(prev => {
			const deduped = [...prev]
			nextItems.forEach(item => {
				const exists = deduped.some(existing => {
					return existing.file.name === item.file.name && existing.file.size === item.file.size && existing.file.lastModified === item.file.lastModified
				})

				if (!exists) {
					deduped.push(item)
				} else {
					URL.revokeObjectURL(item.preview)
				}
			})
			return deduped
		})
	}, [])

	const handleDragEnter = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		event.stopPropagation()
		dragCounterRef.current += 1
		setIsDragging(true)
	}, [])

	const handleDragOver = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		event.stopPropagation()
	}, [])

	const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		event.stopPropagation()
		dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
		if (dragCounterRef.current === 0) {
			setIsDragging(false)
		}
	}, [])

	const handleDrop = useCallback(
		(event: DragEvent<HTMLLabelElement>) => {
			event.preventDefault()
			event.stopPropagation()
			setIsDragging(false)
			dragCounterRef.current = 0
			handleFiles(event.dataTransfer?.files ?? null)
		},
		[handleFiles]
	)

	const totalSize = useMemo(() => {
		const bytes = images.reduce((acc, item) => acc + item.file.size, 0)
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`
	}, [images])

	const handleConvertImage = useCallback(
		async (index: number) => {
			const target = images[index]
			if (!target || target.converting) return
			setImages(prev => prev.map((item, idx) => (idx === index ? { ...item, converting: true } : item)))
			try {
				const blob = await fileToWebp(target.file, quality, limitMaxWidth ? maxWidth : undefined)
				const url = URL.createObjectURL(blob)
				setImages(prev =>
					prev.map((item, idx) => {
						if (idx !== index) return item
						if (item.converted?.url) {
							URL.revokeObjectURL(item.converted.url)
						}
						return {
							...item,
							converting: false,
							converted: {
								url,
								size: blob.size
							}
						}
					})
				)
			} catch (error) {
				console.error(error)
				alert('转换过程中出现问题，请稍后再试')
				setImages(prev => prev.map((item, idx) => (idx === index ? { ...item, converting: false } : item)))
			}
		},
		[images, quality, limitMaxWidth, maxWidth]
	)

	const handleDownloadImage = useCallback(
		(index: number) => {
			const target = images[index]
			if (!target?.converted) return
			const link = document.createElement('a')
			const baseName = target.file.name.replace(/\.[^.]+$/, '')
			link.href = target.converted.url
			link.download = `${baseName}.webp`
			document.body.appendChild(link)
			link.click()
			link.remove()
		},
		[images]
	)

	const handleConvertAll = useCallback(async () => {
		if (!hasImages || batchConverting) return
		setBatchConverting(true)
		try {
			for (let i = 0; i < imagesRef.current.length; i += 1) {
				const current = imagesRef.current[i]
				if (!current) continue
				setImages(prev => prev.map((item, idx) => (idx === i ? { ...item, converting: true } : item)))
				const blob = await fileToWebp(current.file, quality, limitMaxWidth ? maxWidth : undefined)
				const url = URL.createObjectURL(blob)
				setImages(prev =>
					prev.map((item, idx) => {
						if (idx !== i) return item
						if (item.converted?.url) {
							URL.revokeObjectURL(item.converted.url)
						}
						return {
							...item,
							converting: false,
							converted: {
								url,
								size: blob.size
							}
						}
					})
				)
			}
		} catch (error) {
			console.error(error)
			alert('批量转换过程中出现问题，请稍后再试')
		} finally {
			setBatchConverting(false)
		}
	}, [batchConverting, hasImages, quality, limitMaxWidth, maxWidth])

	const handleDownloadAll = useCallback(() => {
		if (!hasConverted) return
		images.forEach(item => {
			if (!item.converted) return
			const link = document.createElement('a')
			const baseName = item.file.name.replace(/\.[^.]+$/, '')
			link.href = item.converted.url
			link.download = `${baseName}.webp`
			document.body.appendChild(link)
			link.click()
			link.remove()
		})
	}, [images, hasConverted])

	const handleRemoveImage = useCallback((index: number) => {
		setImages(prev => {
			const next = [...prev]
			const removed = next.splice(index, 1)[0]
			if (removed) {
				URL.revokeObjectURL(removed.preview)
				if (removed.converted?.url) {
					URL.revokeObjectURL(removed.converted.url)
				}
			}
			return next
		})
	}, [])

	const handleCompareImage = useCallback((index: number) => {
		setCompareIndex(index)
	}, [])

	const handleCloseCompare = useCallback(() => {
		setCompareIndex(null)
	}, [])

	useEffect(() => {
		return () => {
			imagesRef.current.forEach(item => {
				URL.revokeObjectURL(item.preview)
				if (item.converted?.url) {
					URL.revokeObjectURL(item.converted.url)
				}
			})
		}
	}, [])

	const uploadClassName = `group hover:border-brand/20 relative flex cursor-pointer flex-col items-center justify-center gap-3 text-center transition-colors hover:bg-article ${
		embedded ? 'rounded-2xl border border-dashed border-brand/20 bg-brand/5 p-5' : 'card'
	} ${isDragging ? 'border-brand bg-article' : ''}`

	const panelClassName = embedded ? 'relative' : 'card relative'
	const compareImage = compareIndex !== null ? images[compareIndex] : undefined

	return (
		<div className={embedded ? 'relative text-sm' : 'relative px-6 pt-32 pb-12 text-sm max-sm:px-4 max-sm:pt-24'}>
			<div className='mx-auto flex max-w-3xl flex-col gap-6'>
				{!embedded && (
					<motion.div
						initial={{ opacity: 0, scale: 0.9 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ delay: INIT_DELAY }}
						className='space-y-2 text-center'>
						<p className='text-secondary text-xs tracking-[0.2em] uppercase'>Image Toolbox</p>
						<h1 className='text-2xl font-semibold'>PNG / JPG 转 WEBP</h1>
						<p className='text-secondary'>选择图片 → 调整质量 → 一键转换下载</p>
					</motion.div>
				)}

				<motion.label
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY + ANIMATION_DELAY }}
					onDragEnter={handleDragEnter}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					className={uploadClassName}>
					<input type='file' accept='image/*' multiple className='hidden' onChange={event => handleFiles(event.target.files)} />
					<div className='bg-brand/10 text-brand/60 group-hover:bg-brand/10 flex h-20 w-20 items-center justify-center rounded-full text-3xl transition'>
						📷
					</div>
					<div>
						<p className='text-base font-medium'>点击或拖拽图片</p>
						<p className='text-secondary text-xs'>支持 PNG、JPG、JPEG、HEIC 等常见格式</p>
					</div>
				</motion.label>

				{hasImages && (
					<motion.div
						initial={{ opacity: 0, scale: 0.9 }}
						animate={{ opacity: 1, scale: 1 }}
						className={panelClassName}>
						<div className='text-secondary flex items-center justify-between border-b border-border pb-3 text-xs tracking-[0.2em] uppercase'>
							<span>已选择 {images.length} 张图片</span>
							<span>{totalSize}</span>
						</div>
						<ul className='divide-y divide-border'>
							{images.map((item, index) => {
								const { file, preview, converted, converting } = item
								return (
									<li key={`${file.name}-${index}`} className='grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 py-3 max-sm:grid-cols-[48px_minmax(0,1fr)]'>
										<div className='h-12 w-12 overflow-hidden rounded-xl border border-border bg-card'>
											<OptimizedImage src={preview} alt={file.name} width={48} height={48} className='h-full w-full object-cover' />
										</div>
										<div className='flex min-w-0 flex-col'>
											<p className='truncate font-medium'>{formatFileName(file.name)}</p>
											<p className='text-secondary text-xs'>
												{item.width} × {item.height} · {formatBytes(file.size)}
												{converted ? `（转换后 ${formatBytes(converted.size)}）` : ''}
											</p>
										</div>
										<div className='flex flex-wrap justify-end gap-2 text-xs max-sm:col-span-2 max-sm:justify-start'>
											<button
												onClick={() => handleConvertImage(index)}
												disabled={!!converting}
												className='rounded-full px-3 py-1 font-medium transition disabled:cursor-not-allowed disabled:text-secondary/45'>
												{converting ? '转换中...' : converted ? '重新转换' : '转换'}
											</button>
											{converted ? (
												<>
													<button
														onClick={() => handleCompareImage(index)}
														className='border-brand text-brand hover:bg-brand/10 rounded-full border px-3 py-1 font-semibold transition'>
														对比
													</button>
													<button
														onClick={() => handleDownloadImage(index)}
														className='border-brand text-brand hover:bg-brand/10 rounded-full border px-3 py-1 font-semibold transition'>
														下载
													</button>
												</>
											) : null}
											<button
												onClick={() => handleRemoveImage(index)}
												className='rounded-full border border-red-200/60 px-3 py-1 font-medium text-rose-400 transition hover:bg-rose-500/10'>
												移除
											</button>
										</div>
									</li>
								)
							})}
						</ul>
					</motion.div>
				)}

				<motion.div
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY + 2 * ANIMATION_DELAY }}
					className={panelClassName}>
					<div className='flex flex-wrap items-center gap-4 max-sm:flex-col max-sm:items-stretch'>
						<div className='flex-1 space-y-4'>
							<div>
								<p className='text-secondary text-xs tracking-[0.2em] uppercase'>质量</p>
								<div className='flex items-center gap-3 pt-2'>
									<input
										type='range'
										min={0.3}
										max={1}
										step={0.05}
										value={quality}
										onChange={event => setQuality(parseFloat(event.target.value))}
										className='range-track'
									/>
									<span className='w-12 text-right text-sm font-medium'>{Math.round(quality * 100)}%</span>
								</div>
								<p className='text-secondary text-xs'>使用 canvas.toDataURL('image/webp', {quality.toFixed(2)})</p>
							</div>
							<div className='flex items-center gap-3'>
								<div className='flex items-center gap-2'>
									<input
										type='checkbox'
										id='limit-max-width'
										checked={limitMaxWidth}
										onChange={event => setLimitMaxWidth(event.target.checked)}
										className='h-4 w-4 rounded border-border'
									/>
									<label htmlFor='limit-max-width' className='text-secondary cursor-pointer text-xs tracking-[0.2em] uppercase'>
										限制最大宽度
									</label>
								</div>
								{limitMaxWidth && (
									<div className='flex items-center gap-2'>
										<input
											type='number'
											min={100}
											max={10000}
											step={100}
											value={maxWidth}
											onChange={event => setMaxWidth(Math.max(100, parseInt(event.target.value) || 1200))}
											className='w-24 rounded border border-border bg-card px-2 py-1 text-sm'
										/>
										<span className='text-secondary text-xs'>px</span>
									</div>
								)}
							</div>
						</div>
						<div className='flex flex-wrap gap-2 text-sm max-sm:w-full'>
							<button
								onClick={handleConvertAll}
								disabled={!hasConvertible || batchConverting}
								className='rounded-full border border-border px-4 py-2 font-medium transition disabled:cursor-not-allowed disabled:text-secondary/45 max-sm:flex-1'>
								{batchConverting ? '全部转换中…' : '全部转换'}
							</button>
							<button
								onClick={handleDownloadAll}
								disabled={!hasConverted}
								className='border-brand text-brand rounded-full border px-4 py-2 font-semibold transition disabled:cursor-not-allowed disabled:border-border disabled:text-secondary/45 max-sm:flex-1'>
								全部下载
							</button>
						</div>
					</div>
				</motion.div>
			</div>

			{compareImage?.converted && (
				<DialogModal open={true} onClose={handleCloseCompare} className='w-full max-w-6xl max-sm:max-h-[calc(100dvh-2rem)] max-sm:overflow-y-auto'>
					<div className='mb-3 hidden justify-end max-sm:flex'>
						<button onClick={handleCloseCompare} className='rounded-full border border-border bg-card px-3 py-1 text-xs font-medium'>
							关闭
						</button>
					</div>
					<div className='grid w-full grid-cols-2 items-start gap-4 max-sm:grid-cols-1'>
						<div className='flex min-w-0 flex-col items-center p-4 max-sm:p-0'>
							<div className='w-full'>
								<div className='text-secondary text-center text-sm font-medium'>原图 ({formatBytes(compareImage.file.size)})</div>
								<img
									src={compareImage.preview}
									alt='Original'
									loading='lazy'
									decoding='async'
									className='mx-auto mt-3 h-auto max-h-[calc(100vh-8rem)] max-w-full rounded-xl bg-card object-contain max-sm:max-h-[36dvh] max-sm:w-full'
								/>
							</div>
						</div>
						<div className='flex min-w-0 flex-col items-center p-4 max-sm:p-0'>
							<div className='w-full'>
								<div className='text-secondary text-center text-sm font-medium'>WEBP ({formatBytes(compareImage.converted.size)})</div>
								<img
									src={compareImage.converted.url}
									alt='Converted'
									loading='lazy'
									decoding='async'
									className='mx-auto mt-3 h-auto max-h-[calc(100vh-8rem)] max-w-full rounded-xl bg-card object-contain max-sm:max-h-[36dvh] max-sm:w-full'
								/>
							</div>
						</div>
					</div>
				</DialogModal>
			)}
		</div>
	)
}
