'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

export type ImageGallery = { index: number; length: number; onChange: (index: number) => void }

export function ImagePreviewDialog({ src, alt, onClose, gallery, message, onError }: {
	src: string
	alt: string
	onClose: () => void
	gallery?: ImageGallery
	message?: string
	onError?: () => void
}) {
	useEffect(() => {
		const previousOverflow = document.body.style.overflow
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
			if (!gallery || event.altKey || event.metaKey || event.ctrlKey) return
			const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
			if (!direction) return
			event.preventDefault()
			const next = gallery.index + direction
			if (next >= 0 && next < gallery.length) gallery.onChange(next)
		}
		document.body.style.overflow = 'hidden'
		window.addEventListener('keydown', handleKeyDown)
		return () => {
			document.body.style.overflow = previousOverflow
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [gallery, onClose])

	return createPortal(
		<div role='dialog' aria-modal='true' aria-label={`查看图片：${alt}`} className='fixed inset-0 z-[1001] overflow-hidden bg-black/90 p-5' onClick={event => event.currentTarget === event.target && onClose()}>
			{src && !message ? <TransformWrapper key={src} initialScale={1} minScale={1} maxScale={5} centerOnInit panning={{ allowLeftClickPan: true, velocityDisabled: true }} doubleClick={{ mode: 'toggle', step: 1 }}>
				<TransformComponent wrapperClass='touch-none' wrapperStyle={{ width: '100%', height: '100%' }} contentClass='flex items-center justify-center' contentStyle={{ width: '100%', height: '100%' }}>
					<img onError={onError} src={src} alt={alt} draggable={false} className='max-h-full max-w-full select-none object-contain' />
				</TransformComponent>
			</TransformWrapper> : <p role='status' className='grid h-full place-items-center text-center text-sm text-white'>{message || '正在读取图片…'}</p>}
			{gallery && <div className='absolute inset-x-0 bottom-5 mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full bg-black/70 px-2 text-sm text-white'>
				<button type='button' aria-label='上一张' disabled={gallery.index === 0} onClick={() => gallery.onChange(gallery.index - 1)} className='grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-30'><ChevronLeft size={20} /></button>
				<span className='max-w-[50vw] truncate' title={alt}>{alt}</span>
				<span className='shrink-0 text-xs tabular-nums text-white/75'>{gallery.index + 1} / {gallery.length}</span>
				<button type='button' aria-label='下一张' disabled={gallery.index + 1 === gallery.length} onClick={() => gallery.onChange(gallery.index + 1)} className='grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-30'><ChevronRight size={20} /></button>
			</div>}
			<button type='button' autoFocus={!!gallery} onClick={onClose} className='absolute top-4 right-4 flex size-11 items-center justify-center rounded-full bg-black/55 text-white' aria-label='关闭图片预览'>
				<X size={20} />
			</button>
		</div>,
		document.body
	)
}
