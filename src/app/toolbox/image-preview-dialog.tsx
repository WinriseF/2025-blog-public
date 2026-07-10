'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type Point = { x: number; y: number }

const clampScale = (scale: number) => Math.min(5, Math.max(1, scale))

export function ImagePreviewDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
	const dialogRef = useRef<HTMLDivElement>(null)
	const pointersRef = useRef(new Map<number, Point>())
	const pinchDistanceRef = useRef(0)
	const [scale, setScale] = useState(1)

	useEffect(() => {
		const dialog = dialogRef.current
		const previousOverflow = document.body.style.overflow
		const handleWheel = (event: WheelEvent) => {
			event.preventDefault()
			setScale(current => clampScale(current * Math.exp(-event.deltaY * 0.0015)))
		}
		const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
		document.body.style.overflow = 'hidden'
		dialog?.addEventListener('wheel', handleWheel, { passive: false })
		window.addEventListener('keydown', handleKeyDown)
		return () => {
			document.body.style.overflow = previousOverflow
			dialog?.removeEventListener('wheel', handleWheel)
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [onClose])

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.pointerType !== 'touch') return
		event.currentTarget.setPointerCapture(event.pointerId)
		pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
	}

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!pointersRef.current.has(event.pointerId)) return
		pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
		const [a, b] = [...pointersRef.current.values()]
		if (!a || !b) return
		const distance = Math.hypot(a.x - b.x, a.y - b.y)
		if (pinchDistanceRef.current) setScale(current => clampScale(current * distance / pinchDistanceRef.current))
		pinchDistanceRef.current = distance
	}

	const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
		pointersRef.current.delete(event.pointerId)
		if (pointersRef.current.size < 2) pinchDistanceRef.current = 0
	}

	return createPortal(
		<div
			ref={dialogRef}
			role='dialog'
			aria-modal='true'
			aria-label={`查看图片：${alt}`}
			className='fixed inset-0 z-[1001] flex touch-none items-center justify-center overflow-hidden bg-black/90 p-5'
			onClick={event => event.currentTarget === event.target && onClose()}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerEnd}
			onPointerCancel={handlePointerEnd}
		>
			<img src={src} alt={alt} draggable={false} className='max-h-full max-w-full object-contain' style={{ transform: `scale(${scale})` }} />
			<button type='button' onClick={onClose} className='absolute top-4 right-4 flex size-11 items-center justify-center rounded-full bg-black/55 text-white' aria-label='关闭图片预览'>
				<X size={20} />
			</button>
		</div>,
		document.body
	)
}
