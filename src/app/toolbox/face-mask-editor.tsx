'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { drawImageWithMasks } from '@/lib/face-mask/draw-mask'
import { clamp, moveRect, rectFromPoints, resizeRect } from '@/lib/face-mask/geometry'
import { setupMaskInteractions } from '@/lib/face-mask/interactions'
import type { EditorMode, LoadedImage, MaskItem, MaskMode, PreviewRect, Rect } from '@/lib/face-mask/types'

type FaceMaskEditorProps = {
	image: LoadedImage
	masks: MaskItem[]
	selectedMaskId: string | null
	defaultMode: MaskMode
	defaultEmoji: string
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

type DraftRect = {
	startX: number
	startY: number
	currentX: number
	currentY: number
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
						onClick={event => {
							event.stopPropagation()
							onDelete()
						}}
						className='absolute -top-4 -right-4 flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-500 shadow-sm transition hover:bg-rose-50'
						aria-label='删除遮挡区域'>
						<Trash2 size={14} />
					</button>
					<span className='absolute -top-2 -left-2 h-4 w-4 rounded-full border border-border bg-white shadow-sm' />
					<span className='absolute -top-2 -right-2 h-4 w-4 rounded-full border border-border bg-white shadow-sm' />
					<span className='absolute -bottom-2 -left-2 h-4 w-4 rounded-full border border-border bg-white shadow-sm' />
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
	defaultMode,
	defaultEmoji,
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
	const [draft, setDraft] = useState<DraftRect | null>(null)

	const preview = useMemo<PreviewRect>(() => {
		const baseWidth = Math.max(1, Math.min(containerWidth || image.width, image.width))
		const displayWidth = baseWidth * zoom
		return {
			displayWidth,
			displayHeight: (displayWidth * image.height) / image.width,
			scale: displayWidth / image.width
		}
	}, [containerWidth, image.height, image.width, zoom])

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

	const draftRect = draft ? rectFromPoints(draft.startX, draft.startY, draft.currentX, draft.currentY, image.width, image.height) : null

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
			event.preventDefault()
			event.currentTarget.setPointerCapture(event.pointerId)
			setDraft({
				startX: point.x,
				startY: point.y,
				currentX: point.x,
				currentY: point.y
			})
		},
		[creating, eventToOriginalPoint, onSelectMask]
	)

	const handlePointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (!draft) return
			const point = eventToOriginalPoint(event)
			if (!point) return
			setDraft(current => (current ? { ...current, currentX: point.x, currentY: point.y } : current))
		},
		[draft, eventToOriginalPoint]
	)

	const handlePointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (!draft) return
			const point = eventToOriginalPoint(event)
			const rect = point ? rectFromPoints(draft.startX, draft.startY, point.x, point.y, image.width, image.height) : null
			setDraft(null)
			onCreateEnd()
			if (rect) onCreateMask(rect)
		},
		[draft, eventToOriginalPoint, image.height, image.width, onCreateEnd, onCreateMask]
	)

	return (
		<div ref={containerRef} className='overflow-auto rounded-2xl border border-border bg-card/50 p-3'>
			<div
				ref={frameRef}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={() => {
					setDraft(null)
					onCreateEnd()
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

				{draftRect && (
					<div
						className='pointer-events-none absolute rounded-sm border-2 border-dashed border-rose-400 bg-rose-300/10'
						style={{
							left: draftRect.x * preview.scale,
							top: draftRect.y * preview.scale,
							width: draftRect.width * preview.scale,
							height: draftRect.height * preview.scale
						}}
					/>
				)}

				{creating && !draft && <div className='pointer-events-none absolute inset-x-4 bottom-4 rounded-full bg-black/55 px-4 py-2 text-center text-xs font-medium text-white'>拖拽创建遮挡区域</div>}
			</div>

			<p className='text-secondary mt-3 text-center text-xs'>
				当前默认：{defaultMode === 'mosaic' ? '马赛克' : defaultMode === 'blur' ? '模糊' : `表情 ${defaultEmoji}`}。拖拽或缩放白色控制点可调整区域位置和大小。
			</p>
		</div>
	)
}
