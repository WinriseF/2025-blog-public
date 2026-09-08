'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Ban, Download, Image as ImageIcon, Play, ShieldCheck, Trash2 } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import { downloadImageArchive } from '@/lib/image-compress/image-archive'
import type { ImageCompressionOptions } from '@/lib/image-compress/types'
import { ImageCompareDialog } from './image-compare-dialog'
import { ImageOptions } from './image-options'
import { ImageResultList } from './image-result-list'
import { useImageCompress } from './use-image-compress'

const DEFAULT_OPTIONS: ImageCompressionOptions = {
	preset: 'smart',
	output: 'keep',
	compatibility: 'compatible',
	stripMetadata: false,
	jpegBackground: '#ffffff'
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

export function ImageCompressPanel() {
	const controller = useImageCompress()
	const [options, setOptions] = useState<ImageCompressionOptions>(DEFAULT_OPTIONS)
	const [compareId, setCompareId] = useState<string | null>(null)
	const [isDragging, setIsDragging] = useState(false)
	const dragCounter = useRef(0)
	const shouldReduceMotion = useReducedMotion()
	const totalBytes = useMemo(() => controller.items.reduce((total, item) => total + item.file.size, 0), [controller.items])
	const compareItem = compareId ? controller.items.find(item => item.id === compareId) : undefined

	const ingest = useCallback(async (files: FileList | File[]) => {
		const result = await controller.addFiles(files)
		if (result.accepted) toast.success(`已加入 ${result.accepted} 张图片`)
		if (result.rejected.length) toast.error(result.rejected.length === 1 ? result.rejected[0] : `${result.rejected[0]}；另有 ${result.rejected.length - 1} 个文件未加入`)
	}, [controller.addFiles])

	useEffect(() => {
		const handlePaste = (event: ClipboardEvent) => {
			const target = event.target as HTMLElement | null
			if (target?.matches('input, textarea, [contenteditable="true"]')) return
			const files = Array.from(event.clipboardData?.items ?? []).flatMap(item => item.kind === 'file' && item.getAsFile() ? [item.getAsFile()!] : [])
			if (files.length) void ingest(files)
		}
		window.addEventListener('paste', handlePaste)
		return () => window.removeEventListener('paste', handlePaste)
	}, [ingest])

	const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault()
		dragCounter.current = 0
		setIsDragging(false)
		void ingest(event.dataTransfer.files)
	}

	const handleDownloadAll = async () => {
		try {
			await downloadImageArchive(controller.results.map(({ item, result }) => ({ sourceName: item.file.name, format: result.format, blob: result.blob, lastModified: item.file.lastModified })))
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '批量下载失败')
		}
	}

	return (
		<div className='mx-auto flex max-w-5xl flex-col gap-7'>
			<motion.label
				initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98 }}
				animate={{ opacity: 1, scale: 1 }}
				transition={{ delay: INIT_DELAY + ANIMATION_DELAY }}
				onDragEnter={event => { event.preventDefault(); dragCounter.current += 1; setIsDragging(true) }}
				onDragOver={event => event.preventDefault()}
				onDragLeave={event => { event.preventDefault(); dragCounter.current = Math.max(0, dragCounter.current - 1); if (!dragCounter.current) setIsDragging(false) }}
				onDrop={handleDrop}
				className={`group flex min-h-56 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-dashed p-7 text-center transition ${isDragging ? 'border-brand bg-brand/10' : 'border-brand/25 bg-background/25 hover:border-brand/45 hover:bg-brand/5'}`}>
				<input type='file' multiple accept='image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif' className='hidden' onChange={event => { if (event.target.files) void ingest(event.target.files); event.currentTarget.value = '' }} />
				<div className='bg-brand/10 text-brand flex size-16 items-center justify-center rounded-full'><ImageIcon size={30} /></div>
				<div><p className='font-semibold text-primary'>点击、拖拽或粘贴图片</p><p className='text-secondary mt-2 text-sm'>支持静态 JPEG、PNG、WebP、AVIF；HEIC、SVG 和动态图会被明确拒绝</p></div>
			</motion.label>

			<ImageOptions value={options} disabled={controller.isActive} onChange={setOptions} />

			<div className='flex flex-wrap items-center gap-3'>
				<button type='button' disabled={!controller.items.length || controller.isActive} onClick={() => controller.start(controller.items.map(item => item.id), options)} className='bg-brand text-background flex items-center gap-2 rounded-xl px-5 py-3 font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-45'><Play size={16} />全部压缩</button>
				{controller.isActive && <button type='button' onClick={controller.cancelAll} className='flex items-center gap-2 rounded-xl border border-border bg-background/35 px-5 py-3 font-semibold text-primary'><Ban size={15} />取消全部</button>}
				<button type='button' disabled={!controller.results.length} onClick={() => void handleDownloadAll()} className='flex items-center gap-2 rounded-xl border border-border bg-background/35 px-5 py-3 font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-45'><Download size={16} />下载结果{controller.results.length > 1 ? ' ZIP' : ''}</button>
				<button type='button' disabled={!controller.items.length} onClick={controller.clear} className='text-secondary ml-auto flex items-center gap-2 rounded-xl border border-border px-4 py-3 font-medium disabled:opacity-45 max-sm:ml-0'><Trash2 size={15} />清空</button>
				{controller.items.length ? <span className='text-secondary text-xs max-sm:w-full'>原图共 {formatBytes(totalBytes)} · 编码器按候选首次使用时从 CDN 加载</span> : null}
			</div>

			<ImageResultList items={controller.items} onStart={id => controller.start([id], options)} onCancel={controller.cancel} onRemove={controller.remove} onCompare={setCompareId} />

			<div className='text-secondary flex items-start gap-3 border-t border-border pt-5 text-xs leading-5'>
				<ShieldCheck size={17} className='text-brand mt-0.5 shrink-0' />
				<p>图片内容只在当前设备处理，不会上传。MozJPEG、libwebp、libavif、OxiPNG、Pica、exifr 与 libimagequant 均使用固定版本 CDN 并按需加载；智能 PNG 量化所用 <a href='https://github.com/ImageOptim/libimagequant' target='_blank' rel='noreferrer' className='text-brand hover:underline'>libimagequant</a> 为 GPL-3.0+/商业双许可组件。</p>
			</div>

			{compareItem?.result && <ImageCompareDialog item={compareItem} onClose={() => setCompareId(null)} />}
		</div>
	)
}
