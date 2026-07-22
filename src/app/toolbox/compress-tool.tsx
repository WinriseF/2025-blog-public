'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { Download, Eye, Image as ImageIcon, RefreshCw, Trash2 } from 'lucide-react'
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

function savingPercent(original: number, converted?: ConvertedMeta) {
	if (!converted || !original) return null
	return Math.max(0, Math.round((1 - converted.size / original) * 100))
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

export function CompressTool() {
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

	const uploadClassName = `group relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-brand/25 bg-background/25 p-8 text-center transition-colors hover:border-brand/45 hover:bg-brand/5 max-sm:min-h-[220px] max-sm:p-6 ${isDragging ? 'border-brand bg-brand/10' : ''}`
	const compareImage = compareIndex !== null ? images[compareIndex] : undefined
	const rangeProgress = `${Math.round(((quality - 0.3) / 0.7) * 100)}%`

	return (
		<div className='relative text-sm'>
			<div className='mx-auto flex max-w-5xl flex-col gap-8'>
				<div>
					<h1 className='text-2xl font-semibold tracking-normal text-primary'>图片压缩</h1>
					<p className='text-secondary mt-3 text-sm'>本地转换为 WEBP，不上传服务器</p>
				</div>

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
					<div className='bg-brand/10 text-brand group-hover:bg-brand/15 flex h-20 w-20 items-center justify-center rounded-full transition max-sm:h-16 max-sm:w-16'>
						<ImageIcon size={34} strokeWidth={1.8} />
					</div>
					<div>
						<p className='text-lg font-semibold text-primary max-sm:text-base'>点击或拖拽图片到这里</p>
						<p className='text-secondary mt-3 text-sm'>支持 PNG、JPG、JPEG、HEIC</p>
					</div>
				</motion.label>

				<motion.div
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY + 2 * ANIMATION_DELAY }}
					className='relative'>
					<div className='space-y-6'>
						<div className='grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]'>
							<div className='min-w-0'>
								<label htmlFor='compress-quality' className='text-sm font-semibold text-primary'>质量</label>
								<div className='mt-5 grid grid-cols-[minmax(0,1fr)_64px] items-center gap-8 max-sm:grid-cols-[minmax(0,1fr)_48px] max-sm:gap-4'>
									<input id='compress-quality' type='range' min={0.3} max={1} step={0.05} value={quality} onChange={event => setQuality(parseFloat(event.target.value))} className='range-track' style={{ '--range-progress': rangeProgress } as CSSProperties} />
									<span className='text-right text-base font-medium text-primary'>{Math.round(quality * 100)}%</span>
								</div>
							</div>

							<div className='flex items-center gap-3 max-sm:flex-wrap'>
								<input type='checkbox' id='limit-max-width' checked={limitMaxWidth} onChange={event => setLimitMaxWidth(event.target.checked)} className='h-4 w-4 rounded border-border bg-card accent-[var(--color-brand)]' />
								<label htmlFor='limit-max-width' className='cursor-pointer text-sm font-medium text-primary'>限制最大宽度</label>
								<input type='number' min={100} max={10000} step={100} value={maxWidth} disabled={!limitMaxWidth} onChange={event => setMaxWidth(Math.max(100, parseInt(event.target.value) || 1200))} className='h-10 w-28 rounded-lg border border-border bg-card px-3 text-sm text-primary shadow-sm outline-none transition disabled:text-secondary/45 disabled:opacity-70' />
								<span className='text-secondary text-sm'>px</span>
							</div>
						</div>

						<div className='flex flex-wrap gap-3 text-sm'>
							<button
								onClick={handleConvertAll}
								disabled={!hasConvertible || batchConverting}
								className='bg-brand text-background flex min-w-28 items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 max-sm:flex-1'>
								<RefreshCw size={15} className={batchConverting ? 'animate-spin' : ''} />
								{batchConverting ? '全部转换中…' : '全部转换'}
							</button>
							<button
								onClick={handleDownloadAll}
								disabled={!hasConverted}
								className='flex min-w-28 items-center justify-center gap-2 rounded-xl border border-border bg-background/40 px-5 py-3 font-semibold text-primary shadow-sm transition hover:border-brand/45 disabled:cursor-not-allowed disabled:text-secondary/45 max-sm:flex-1'>
								<Download size={15} />
								全部下载
							</button>
						</div>
					</div>
				</motion.div>

				<section className='border-t border-border pt-6'>
					{hasImages ? (
						<motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className='relative'>
							<div className='mb-2 flex items-center justify-between gap-3'>
								<h2 className='text-sm font-semibold text-primary'>压缩结果（{images.length}）</h2>
								<span className='text-secondary text-xs'>原图总计 {totalSize}</span>
							</div>
							<ul className='divide-y divide-border'>
								{images.map((item, index) => {
									const { file, preview, converted, converting } = item
									const percent = savingPercent(file.size, converted)
									return (
										<li key={`${file.name}-${index}`} className='grid grid-cols-[56px_minmax(150px,1fr)_auto_auto] items-center gap-4 py-4 max-lg:grid-cols-[56px_minmax(0,1fr)_auto] max-sm:grid-cols-[52px_minmax(0,1fr)]'>
											<div className='h-14 w-14 overflow-hidden rounded-lg border border-border bg-card max-sm:h-12 max-sm:w-12'>
												<OptimizedImage src={preview} alt={file.name} width={56} height={56} className='h-full w-full object-cover' />
											</div>
											<div className='min-w-0'>
												<p className='truncate font-medium text-primary'>{formatFileName(file.name)}</p>
												<p className='text-secondary mt-1 text-xs'>{item.width} × {item.height}</p>
											</div>
											<div className='flex items-center gap-4 text-sm max-lg:col-span-2 max-lg:col-start-2 max-sm:col-span-2 max-sm:col-start-1 max-sm:flex-wrap max-sm:gap-3'>
												<span className='text-secondary'>原始：{formatBytes(file.size)}</span>
												<span className='text-secondary'>→</span>
												<span className='text-primary'>WEBP：{converted ? formatBytes(converted.size) : converting ? '转换中...' : '待转换'}</span>
												{percent !== null && <span className='rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600'>节省 {percent}%</span>}
											</div>
											<div className='flex justify-end gap-2 text-xs max-sm:col-span-2 max-sm:justify-start'>
												<button
													onClick={() => handleConvertImage(index)}
													disabled={!!converting}
													className='flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2 font-medium text-primary transition hover:border-brand/45 disabled:cursor-not-allowed disabled:text-secondary/45'>
													<RefreshCw size={14} className={converting ? 'animate-spin' : ''} />
													{converting ? '转换中' : converted ? '重转' : '转换'}
												</button>
												<button
													onClick={() => handleCompareImage(index)}
													disabled={!converted}
													className='flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2 font-medium text-primary transition hover:border-brand/45 disabled:cursor-not-allowed disabled:text-secondary/45'>
													<Eye size={14} />
													对比
												</button>
												<button
													onClick={() => handleDownloadImage(index)}
													disabled={!converted}
													className='text-brand flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2 font-semibold transition hover:border-brand/45 disabled:cursor-not-allowed disabled:text-secondary/45'>
													<Download size={14} />
													下载
												</button>
												<button
													onClick={() => handleRemoveImage(index)}
													className='text-secondary hover:text-primary flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2 font-medium transition hover:border-brand/45'>
													<Trash2 size={14} />
													移除
												</button>
											</div>
										</li>
									)
								})}
							</ul>
						</motion.div>
					) : (
						<div className='text-secondary flex min-h-36 flex-col items-center justify-center text-center'>
							<ImageIcon size={34} strokeWidth={1.6} className='mb-3 opacity-35' />
							<p className='text-sm font-medium'>暂无图片</p>
							<p className='mt-2 text-sm'>上传图片后将在这里显示压缩结果</p>
						</div>
					)}
				</section>
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
