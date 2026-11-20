'use client'

import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

export type ImageGallery = { index: number; length: number; swipe?: boolean; onChange: (index: number) => void }

export function ImagePreviewDialog({ src, alt, onClose, gallery, message, onError }: {
	src: string
	alt: string
	onClose: () => void
	gallery?: ImageGallery
	message?: string
	onError?: () => void
}) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const zoom = useRef(1)
	const swipeStart = useRef<{ x: number; y: number } | null>(null)
	useLayoutEffect(() => {
		const dialog = dialogRef.current!
		const previousOverflow = document.body.style.overflow
		dialog.showModal()
		document.body.style.overflow = 'hidden'
		return () => {
			document.body.style.overflow = previousOverflow
			dialog.close()
		}
	}, [])

	function step(direction: number) {
		if (!gallery) return
		const next = gallery.index + direction
		if (next >= 0 && next < gallery.length) gallery.onChange(next)
	}

	return createPortal(
		<dialog ref={dialogRef} aria-label={`查看图片：${alt}`} className='fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-black/90 p-5 backdrop:bg-transparent'
			onClick={event => event.currentTarget === event.target && onClose()}
			onCancel={event => { event.preventDefault(); onClose() }}
			onKeyDown={event => {
				if (event.key === 'Tab') {
					const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled')
					const first = buttons[0]
					const last = buttons[buttons.length - 1]
					if (event.target === (event.shiftKey ? first : last)) {
						event.preventDefault()
						const next = event.shiftKey ? last : first
						next.focus()
					}
					return
				}
				if (!gallery || event.altKey || event.metaKey || event.ctrlKey) return
				const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
				if (!direction) return
				event.preventDefault()
				step(direction)
			}}
			onTouchStartCapture={event => {
				const touch = event.touches[0]
				swipeStart.current = gallery?.swipe && zoom.current === 1 && event.touches.length === 1 && !(event.target as Element).closest('button')
					? { x: touch.clientX, y: touch.clientY } : null
			}}
			onTouchCancelCapture={() => { swipeStart.current = null }}
			onTouchEndCapture={event => {
				const start = swipeStart.current
				swipeStart.current = null
				if (!start || !gallery || zoom.current !== 1) return
				const touch = event.changedTouches[0]
				const dx = touch.clientX - start.x
				if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(touch.clientY - start.y) * 1.5) return
				step(-Math.sign(dx))
			}}>
			<button type='button' onClick={onClose} className='absolute top-4 right-4 z-10 flex size-11 items-center justify-center rounded-full bg-black/55 text-white' aria-label='关闭图片预览'>
				<X size={20} />
			</button>
			{src && !message ? <TransformWrapper key={src} onInit={() => { zoom.current = 1 }} onTransform={(_, state) => { zoom.current = state.scale }} initialScale={1} minScale={1} maxScale={5} centerOnInit panning={{ allowLeftClickPan: true, velocityDisabled: true }} doubleClick={{ mode: 'toggle', step: 1 }}>
				<TransformComponent wrapperClass='touch-none' wrapperStyle={{ width: '100%', height: '100%' }} contentClass='flex items-center justify-center' contentStyle={{ width: '100%', height: '100%' }}>
					<img onError={onError} src={src} alt={alt} draggable={false} className='max-h-full max-w-full select-none object-contain' />
				</TransformComponent>
			</TransformWrapper> : <p role='status' className='grid h-full place-items-center text-center text-sm text-white'>{message || '正在读取图片…'}</p>}
			{gallery && <div className='absolute inset-x-0 bottom-5 mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full bg-black/70 px-2 text-sm text-white'>
				<button type='button' aria-label='上一张' aria-disabled={gallery.index === 0} onClick={() => step(-1)} className='grid size-11 shrink-0 place-items-center rounded-full aria-disabled:opacity-30'><ChevronLeft size={20} /></button>
				<span className='max-w-[50vw] truncate' title={alt}>{alt}</span>
				<span className='shrink-0 text-xs tabular-nums text-white/75'>{gallery.index + 1} / {gallery.length}</span>
				<button type='button' aria-label='下一张' aria-disabled={gallery.index + 1 === gallery.length} onClick={() => step(1)} className='grid size-11 shrink-0 place-items-center rounded-full aria-disabled:opacity-30'><ChevronRight size={20} /></button>
			</div>}
		</dialog>,
		document.body
	)
}
