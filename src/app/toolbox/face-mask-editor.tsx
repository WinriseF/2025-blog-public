'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { drawImageWithMasks } from '@/lib/face-mask/draw-mask'
import { clamp, moveRect, rectFromCenter, resizeRect } from '@/lib/face-mask/geometry'
import { setupMaskInteractions } from '@/lib/face-mask/interactions'
import type { EditorMode, LoadedImage, MaskItem, PreviewRect, Rect } from '@/lib/face-mask/types'

const CREATE_TAP_MOVE_THRESHOLD = 10

type FaceMaskEditorProps = {
	image: LoadedImage
	masks: MaskItem[]
	selectedMaskId: string | null
	creating: boolean
	zoom: number
	onCreateMask: (rect: Rect) => void
	onCreateEnd: () => void
	onSelectMask: (id: string | null) => void
	onMoveMask: (id: string, dx: number, dy: number) => void
	onResizeMask: (id: string, width: number, height: number) => void
	onDeleteMask: (id: string) => void
	onInteractionStart: (mode: EditorMode) => void
	onInteractionEnd: () => void
}

type CreateTap = {
	pointerId: number
	startClientX: number
	startClientY: number
	point: {
		x: number
		y: number
	}
	moved: boolean
}

function useContainerWidth() {
	const ref = useRef<HTMLDivElement | null>(null)
	const [width, setWidth] = useState(0)

	useEffect(() => {
		const element = ref.current
		if (!element) return

		const resize = () => setWidth(element.clientWidth)
		resize()
		const observer = new ResizeObserver(resize)
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	return { ref, width }
}

function MaskOverlayItem({
	mask,
	image,
	preview,
	selected,
	creating,
	onSelect,
	onMove,
	onResize,
	onDelete,
	onInteractionStart,
	onInteractionEnd
}: {
	mask: MaskItem
	image: LoadedImage
	preview: PreviewRect
	selected: boolean
	creating: boolean
	onSelect: () => void
	onMove: (dx: number, dy: number) => void
	onResize: (width: number, height: number) => void
	onDelete: () => void
	onInteractionStart: (mode: EditorMode) => void
	onInteractionEnd: () => void
}) {
	const ref = useRef<HTMLDivElement | null>(null)
	const maskRef = useRef(mask)
	const handlersRef = useRef({
		onSelect,
		onMove,
		onResize,
		onDelete,
		onInteractionStart,
		onInteractionEnd
	})

	useEffect(() => {
		maskRef.current = mask
		handlersRef.current = {
			onSelect,
			onMove,
			onResize,
			onDelete,
			onInteractionStart,
			onInteractionEnd
		}
	})

	useEffect(() => {
		const element = ref.current
		if (!element) return

		return setupMaskInteractions(element, {
			scale: preview.scale,
			enabled: !creating,
			onSelect: () => handlersRef.current.onSelect(),
			onStart: mode => handlersRef.current.onInteractionStart(mode),
			onMove: (dx, dy) => {
				const current = maskRef.current
				const next = moveRect(current, dx, dy, image.width, image.height)
				handlersRef.current.onMove(next.x - current.x, next.y - current.y)
			},
			onResize: payload => {
				const next = resizeRect(maskRef.current, payload.width, payload.height, image.width, image.height)
				handlersRef.current.onResize(next.width, next.height)
			},
			onEnd: () => handlersRef.current.onInteractionEnd()
		})
	}, [creating, image.height, image.width, preview.scale])

	return (
		<div
			ref={ref}
			onPointerDown={event => {
				event.stopPropagation()
				onSelect()
			}}
			className={`face-mask-overlay-item absolute touch-none rounded-sm border-2 ${
				selected ? 'border-rose-400 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]' : 'border-white/90'
			} border-dashed`}
			style={{
				left: mask.x * preview.scale,
				top: mask.y * preview.scale,
				width: mask.width * preview.scale,
				height: mask.height * preview.scale
			}}>
			{selected && (
				<>
					<button
						type='button'
						onPointerDown={event => event.stopPropagation()}
						onClick={event => {
							event.stopPropagation()
							onDelete()
						}}
						className='absolute -top-3.5 -left-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-rose-500 text-white shadow-sm transition hover:bg-rose-600 active:scale-95'
						aria-label='删除遮挡区域'>
						<Trash2 size={13} />
					</button>
					<span className='face-mask-resize-handle absolute -right-2 -bottom-2 h-5 w-5 rounded-full border-2 border-white bg-rose-400 shadow-sm' />
				</>
			)}
		</div>
	)
}

export function FaceMaskEditor({
	image,
	masks,
	selectedMaskId,
	creating,
	zoom,
	onCreateMask,
	onCreateEnd,
	onSelectMask,
	onMoveMask,
	onResizeMask,
	onDeleteMask,
	onInteractionStart,
	onInteractionEnd
}: FaceMaskEditorProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const frameRef = useRef<HTMLDivElement | null>(null)
	const { ref: containerRef, width: containerWidth } = useContainerWidth()
	const createTapRef = useRef<CreateTap | null>(null)

	const preview = useMemo<PreviewRect>(() => {
		const baseWidth = Math.max(1, Math.min(containerWidth || image.width, image.width))
		const displayWidth = baseWidth * zoom
		return {
			displayWidth,
			displayHeight: (displayWidth * image.height) / image.width,
			scale: displayWidth / image.width
		}
	}, [containerWidth, image.height, image.width, zoom])

	const defaultMaskSize = useMemo(() => {
		const visualSize = clamp(Math.min(preview.displayWidth, preview.displayHeight) * 0.24, 72, 128)
		const size = visualSize / preview.scale
		return { width: size, height: size }
	}, [preview.displayHeight, preview.displayWidth, preview.scale])

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		let canceled = false
		canvas.width = image.width
		canvas.height = image.height

		try {
			drawImageWithMasks(canvas, image.bitmap, masks)
		} catch (error) {
			if (!canceled) console.error(error)
		}

		return () => {
			canceled = true
		}
	}, [image, masks])

	const eventToOriginalPoint = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const frame = frameRef.current
			if (!frame) return null
			const rect = frame.getBoundingClientRect()
			return {
				x: clamp((event.clientX - rect.left) / preview.scale, 0, image.width),
				y: clamp((event.clientY - rect.top) / preview.scale, 0, image.height)
			}
		},
		[image.height, image.width, preview.scale]
	)

	const handlePointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const target = event.target as HTMLElement
			if (target.closest('.face-mask-overlay-item')) return

			if (!creating) {
				onSelectMask(null)
				return
			}

			const point = eventToOriginalPoint(event)
			if (!point) return
			event.currentTarget.setPointerCapture(event.pointerId)
			createTapRef.current = {
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				point,
				moved: false
			}
		},
		[creating, eventToOriginalPoint, onSelectMask]
	)

	const handlePointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const tap = createTapRef.current
			if (!tap || tap.pointerId !== event.pointerId) return
			const dx = event.clientX - tap.startClientX
			const dy = event.clientY - tap.startClientY
			if (Math.hypot(dx, dy) > CREATE_TAP_MOVE_THRESHOLD) tap.moved = true
		},
		[]
	)

	const handlePointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const tap = createTapRef.current
			if (!tap || tap.pointerId !== event.pointerId) return
			createTapRef.current = null
			if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
			if (!creating || tap.moved) return
			const rect = rectFromCenter(tap.point.x, tap.point.y, defaultMaskSize.width, defaultMaskSize.height, image.width, image.height)
			onCreateMask(rect)
			onCreateEnd()
		},
		[creating, defaultMaskSize.height, defaultMaskSize.width, image.height, image.width, onCreateEnd, onCreateMask]
	)

	return (
		<div ref={containerRef} className='overflow-auto'>
			<div
				ref={frameRef}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={event => {
					const tap = createTapRef.current
					if (!tap || tap.pointerId !== event.pointerId) return
					createTapRef.current = null
					if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
				}}
				className={`relative mx-auto overflow-hidden rounded-xl bg-background/40 ${creating ? 'cursor-crosshair' : 'cursor-default'}`}
				style={{
					width: preview.displayWidth,
					height: preview.displayHeight
				}}>
				<canvas
					ref={canvasRef}
					className='block h-full w-full select-none'
					style={{
						width: preview.displayWidth,
						height: preview.displayHeight
					}}
				/>

				{masks.map(mask => (
					<MaskOverlayItem
						key={mask.id}
						mask={mask}
						image={image}
						preview={preview}
						selected={mask.id === selectedMaskId}
						creating={creating}
						onSelect={() => onSelectMask(mask.id)}
						onMove={(dx, dy) => onMoveMask(mask.id, dx, dy)}
						onResize={(width, height) => onResizeMask(mask.id, width, height)}
						onDelete={() => onDeleteMask(mask.id)}
						onInteractionStart={onInteractionStart}
						onInteractionEnd={onInteractionEnd}
					/>
				))}
			</div>
		</div>
	)
}
