'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { X } from 'lucide-react'

export function ImagePreviewDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
	useEffect(() => {
		const previousOverflow = document.body.style.overflow
		const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
		document.body.style.overflow = 'hidden'
		window.addEventListener('keydown', handleKeyDown)
		return () => {
			document.body.style.overflow = previousOverflow
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [onClose])

	return createPortal(
		<div role='dialog' aria-modal='true' aria-label={`查看图片：${alt}`} className='fixed inset-0 z-[1001] overflow-hidden bg-black/90 p-5' onClick={event => event.currentTarget === event.target && onClose()}>
			<TransformWrapper
				initialScale={1}
				minScale={1}
				maxScale={5}
				centerOnInit
				panning={{ allowLeftClickPan: true, velocityDisabled: true }}
				doubleClick={{ mode: 'toggle', step: 1 }}
			>
				<TransformComponent wrapperClass='touch-none' wrapperStyle={{ width: '100%', height: '100%' }} contentClass='flex items-center justify-center' contentStyle={{ width: '100%', height: '100%' }}>
					<img src={src} alt={alt} draggable={false} className='max-h-full max-w-full select-none object-contain' />
				</TransformComponent>
			</TransformWrapper>
			<button type='button' onClick={onClose} className='absolute top-4 right-4 flex size-11 items-center justify-center rounded-full bg-black/55 text-white' aria-label='关闭图片预览'>
				<X size={20} />
			</button>
		</div>,
		document.body
	)
}
