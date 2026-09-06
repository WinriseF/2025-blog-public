'use client'

import { useRef } from 'react'
import { GripVertical } from 'lucide-react'

export type TimelineRange = [number, number]
export type TimelineBrushSegment = { id: string; x: number; width: number; y?: number; height?: number; color: string; opacity?: number; startDivider?: boolean }

type DragMode = 'move' | 'start' | 'end'

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(Math.max(value, minimum), maximum)
}

export function TimelineBrush({ totalWidth, range, segments, onChange, onCommit, onCancel, minimumSpan: requestedMinimumSpan = 0.04, keyboardStep = 0.01, embedded = false }: {
	totalWidth: number
	range: TimelineRange
	segments: TimelineBrushSegment[]
	onChange: (range: TimelineRange) => void
	onCommit?: (range: TimelineRange) => void
	onCancel?: () => void
	minimumSpan?: number
	keyboardStep?: number
	embedded?: boolean
}) {
	const minimumSpan = Math.min(requestedMinimumSpan, range[1] - range[0])
	const drag = useRef<{ mode: DragMode; x: number; range: TimelineRange; latest: TimelineRange } | undefined>(undefined)
	const update = (next: TimelineRange) => {
		if (drag.current) drag.current.latest = next
		onChange(next)
	}

	const startDrag = (mode: DragMode, event: React.PointerEvent<HTMLElement>) => {
		event.stopPropagation()
		event.currentTarget.setPointerCapture(event.pointerId)
		drag.current = { mode, x: event.clientX, range: [...range], latest: [...range] }
	}
	const move = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return
		const delta = (event.clientX - drag.current.x) / Math.max(event.currentTarget.getBoundingClientRect().width, 1)
		const [start, end] = drag.current.range
		if (drag.current.mode === 'move') {
			const span = end - start
			const nextStart = clamp(start + delta, 0, 1 - span)
			update([nextStart, nextStart + span])
		} else if (drag.current.mode === 'start') update([clamp(start + delta, 0, end - minimumSpan), end])
		else update([start, clamp(end + delta, start + minimumSpan, 1)])
	}
	const finish = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return
		move(event)
		onCommit?.(drag.current.latest)
		drag.current = undefined
	}
	const cancel = () => {
		drag.current = undefined
		onCancel?.()
	}
	const jump = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return
		const rect = event.currentTarget.getBoundingClientRect()
		const center = (event.clientX - rect.left) / Math.max(rect.width, 1)
		const span = range[1] - range[0]
		const start = clamp(center - span / 2, 0, 1 - span)
		const next: TimelineRange = [start, start + span]
		onChange(next)
		onCommit?.(next)
	}
	const keyMove = (mode: 'start' | 'end', event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
		event.preventDefault()
		const delta = event.key === 'ArrowLeft' ? -keyboardStep : keyboardStep
		const next: TimelineRange = mode === 'start'
			? [clamp(range[0] + delta, 0, range[1] - minimumSpan), range[1]]
			: [range[0], clamp(range[1] + delta, range[0] + minimumSpan, 1)]
		onChange(next)
		onCommit?.(next)
	}

	return <div className={embedded ? undefined : 'border-t border-border px-3 py-3'}>
		<div className={`${embedded ? 'h-12' : 'h-11'} relative touch-none select-none rounded-md border border-border bg-foreground/[0.018]`} onPointerDown={jump} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}>
			<svg viewBox={`0 0 ${Math.max(totalWidth, 1)} 36`} width='100%' height='100%' preserveAspectRatio='none' className='pointer-events-none absolute inset-0'>
				{segments.map(segment => {
					const y = segment.y ?? 8
					const height = segment.height ?? 20
					return <g key={segment.id}>
						<rect x={segment.x} y={y} width={Math.max(segment.width, 1)} height={height} fill={segment.color} fillOpacity={segment.opacity ?? 0.55} />
						{segment.startDivider && <line x1={segment.x} x2={segment.x} y1={y} y2={y + height} stroke='var(--color-border)' strokeWidth={1} strokeOpacity={0.9} vectorEffect='non-scaling-stroke' />}
					</g>
				})}
			</svg>
			<div className='pointer-events-none absolute inset-y-0 left-0 bg-background/65' style={{ width: `${range[0] * 100}%` }} />
			<div className='pointer-events-none absolute inset-y-0 right-0 bg-background/65' style={{ width: `${(1 - range[1]) * 100}%` }} />
			<div className='border-brand bg-brand/5 absolute inset-y-0 cursor-grab border-y active:cursor-grabbing' style={{ left: `${range[0] * 100}%`, width: `${(range[1] - range[0]) * 100}%` }} onPointerDown={event => startDrag('move', event)}>
				<button type='button' aria-label='拖动左侧把手调整起点' className='absolute top-1/2 left-0 z-20 h-10 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand' onPointerDown={event => startDrag('start', event)} onKeyDown={event => keyMove('start', event)}><span className='bg-brand absolute top-1/2 left-1/2 flex h-7 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md text-white shadow-sm'><GripVertical size={11} /></span></button>
				<button type='button' aria-label='拖动右侧把手调整终点' className='absolute top-1/2 right-0 z-20 h-10 w-7 translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand' onPointerDown={event => startDrag('end', event)} onKeyDown={event => keyMove('end', event)}><span className='bg-brand absolute top-1/2 left-1/2 flex h-7 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md text-white shadow-sm'><GripVertical size={11} /></span></button>
			</div>
		</div>
		{!embedded && <p className='text-secondary mt-1.5 text-center text-[9px]'>拖动选区浏览 · 拖动两侧把手缩放</p>}
	</div>
}
