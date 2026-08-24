'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { TokenTimeBucket } from '@/lib/codex-session/types'
import { TimelineBrush, type TimelineRange } from './timeline-brush'

const COLORS = [
	{ key: 'freshInput', label: 'Fresh input', color: 'var(--color-brand)' },
	{ key: 'cachedInput', label: 'Cached input', color: '#22c55e' },
	{ key: 'output', label: 'Output', color: '#f59e0b' },
	{ key: 'unallocated', label: '未细分', color: '#94a3b8' }
] as const

function dateFromKey(key: string) {
	const [year, month, day] = key.split('-').map(Number)
	return new Date(year, month - 1, day, 12)
}

function dateKey(date: Date) {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function fillCalendarDays(data: TokenTimeBucket[]) {
	if (data.length < 2) return data
	const byDate = new Map(data.map(item => [item.key, item]))
	const cursor = dateFromKey(data[0].key)
	const end = dateFromKey(data.at(-1)!.key)
	if ((end.getTime() - cursor.getTime()) / 86_400_000 > 1095) return data
	const result: TokenTimeBucket[] = []
	while (cursor.getTime() <= end.getTime()) {
		const key = dateKey(cursor)
		result.push(byDate.get(key) ?? { key, input: 0, freshInput: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0, sessionCount: 0, unallocated: 0 })
		cursor.setDate(cursor.getDate() + 1)
	}
	return result
}

function axisFormatter(maximum: number) {
	const unit = maximum >= 100_000_000
		? { divisor: 100_000_000, suffix: '亿' }
		: maximum >= 10_000
			? { divisor: 10_000, suffix: '万' }
			: { divisor: 1, suffix: '' }
	return (value: number) => {
		if (!value) return '0'
		const scaled = value / unit.divisor
		return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')}${unit.suffix}`
	}
}

const MainBars = memo(function MainBars({ data, maximum, labelStride }: { data: TokenTimeBucket[]; maximum: number; labelStride: number }) {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
	const hovered = hoveredIndex === null ? null : data[hoveredIndex]
	const tooltipTransform = hoveredIndex === null || hoveredIndex < data.length / 3
		? 'translateX(8px)'
		: hoveredIndex > data.length * 2 / 3
			? 'translateX(calc(-100% - 8px))'
			: 'translateX(-50%)'
	const tooltipRows = hovered ? [
		{ label: 'Fresh input', value: hovered.freshInput, color: 'var(--color-brand)' },
		{ label: 'Cached input', value: hovered.cachedInput, color: '#22c55e' },
		{ label: 'Output', value: hovered.output, color: '#f59e0b' },
		{ label: 'Reasoning（Output 子集）', value: hovered.reasoningOutput, color: '#a855f7' },
		{ label: '未细分', value: hovered.unallocated, color: '#94a3b8' }
	].filter(row => row.value > 0) : []

	return <div className='absolute inset-0 grid items-end px-1' style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`, columnGap: data.length > 240 ? 0 : 1 }}>
		{data.map((item, index) => {
			const description = `${item.key}，总量 ${item.total.toLocaleString('zh-CN')}`
			return <div
				key={item.key}
				role='img'
				aria-label={description}
				onPointerEnter={() => item.total > 0 && setHoveredIndex(index)}
				onPointerLeave={() => setHoveredIndex(current => current === index ? null : current)}
				className='relative flex h-full min-w-0 items-end justify-center'
			>
				<div className='flex w-[72%] min-w-px max-w-7 flex-col-reverse overflow-hidden rounded-t-[2px] opacity-90 hover:opacity-100' style={{ height: `${(item.total / maximum) * 100}%` }}>
					{COLORS.map(segment => {
						const value = item[segment.key]
						return value > 0 ? <span key={segment.key} style={{ height: `${(value / item.total) * 100}%`, background: segment.color }} /> : null
					})}
				</div>
				{(index % labelStride === 0 || index === data.length - 1) && <span className={`text-secondary absolute top-[calc(100%+7px)] whitespace-nowrap text-[10px] ${index === 0 ? 'left-0' : index === data.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>{item.key.slice(5)}</span>}
				{hoveredIndex === index && hovered && <>
					<div className='pointer-events-none absolute inset-y-0 left-1/2 z-20 w-px -translate-x-1/2 bg-brand/70' />
					<div
						className='pointer-events-none absolute top-2 left-1/2 z-30 min-w-48 rounded-xl border border-border bg-background/95 px-3.5 py-3 text-xs shadow-xl backdrop-blur-md'
						style={{ transform: tooltipTransform }}
					>
						<div className='mb-2 flex items-baseline justify-between gap-4'>
							<strong className='font-medium text-primary'>{hovered.key}</strong>
							<span className='text-secondary tabular-nums'>总量 {hovered.total.toLocaleString('zh-CN')}</span>
						</div>
						<div className='space-y-1.5'>
							{tooltipRows.map(row => <div key={row.label} className='flex items-center justify-between gap-5'>
								<span style={{ color: row.color }}>{row.label}</span>
								<span className='font-mono tabular-nums text-primary'>{row.value.toLocaleString('zh-CN')}</span>
							</div>)}
						</div>
					</div>
				</>}
			</div>
		})}
	</div>
})

type RangeBrushProps = {
	data: TokenTimeBucket[]
	dateFrom?: string
	dateTo?: string
	onChange: (dateFrom?: string, dateTo?: string) => void
}

function RangeBrush({ data, dateFrom, dateTo, onChange }: RangeBrushProps) {
	const dates = useMemo(() => data.map(item => item.key), [data])
	const maximum = Math.max(...data.map(item => item.total), 1)
	const initialRange = useMemo(() => {
		const foundStart = dateFrom ? dates.findIndex(date => date >= dateFrom) : 0
		const start = foundStart < 0 ? dates.length - 1 : foundStart
		const last = dateTo ? dates.findLastIndex(date => date <= dateTo) : dates.length - 1
		return { start, end: Math.min(Math.max(last + 1, start + 1), dates.length) }
	}, [dateFrom, dateTo, dates])
	const [range, setRangeState] = useState(initialRange)

	useEffect(() => {
		setRangeState(initialRange)
	}, [initialRange])

	const snap = ([startRatio, endRatio]: TimelineRange) => {
		const start = Math.min(Math.max(Math.round(startRatio * dates.length), 0), dates.length - 1)
		const end = Math.min(Math.max(Math.round(endRatio * dates.length), start + 1), dates.length)
		return { start, end }
	}
	const update = (next: TimelineRange) => setRangeState(snap(next))
	const commit = (next: TimelineRange) => {
		const current = snap(next)
		if (current.start === 0 && current.end === dates.length) onChange()
		else onChange(dates[current.start], dates[current.end - 1])
	}
	const normalized: TimelineRange = [range.start / dates.length, range.end / dates.length]
	const segments = data.map((item, index) => {
		const height = Math.max((item.total / maximum) * 30, item.total ? 2 : 0)
		return { id: item.key, x: index, width: 1, y: 34 - height, height, color: 'var(--color-brand)', opacity: 0.5 }
	})
	return <TimelineBrush
		totalWidth={dates.length}
		range={normalized}
		segments={segments}
		onChange={update}
		onCommit={commit}
		onCancel={() => setRangeState(initialRange)}
		minimumSpan={1 / dates.length}
		keyboardStep={1 / dates.length}
		embedded
	/>
}

type CollectionTokenChartProps = {
	data: TokenTimeBucket[]
	dateFrom?: string
	dateTo?: string
	onRangeChange: (dateFrom?: string, dateTo?: string) => void
}

export default function CollectionTokenChart({ data, dateFrom, dateTo, onRangeChange }: CollectionTokenChartProps) {
	const timeline = useMemo(() => fillCalendarDays(data), [data])
	const visible = useMemo(() => timeline.filter(item => (!dateFrom || item.key >= dateFrom) && (!dateTo || item.key <= dateTo)), [dateFrom, dateTo, timeline])
	const maximum = Math.max(...visible.map(item => item.total), 1)
	const formatAxis = axisFormatter(maximum)
	const labelStride = Math.max(Math.ceil(visible.length / 8), 1)
	const ticks = [maximum, maximum * 0.75, maximum * 0.5, maximum * 0.25, 0]
	const selectedLabel = dateFrom || dateTo ? `${dateFrom ?? timeline[0]?.key} — ${dateTo ?? timeline.at(-1)?.key}` : '全部时间'

	return (
		<div>
			<div className='mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[10px]'>
				{COLORS.map(item => <span key={item.key} className='text-secondary flex items-center gap-1.5'><span className='size-2 rounded-sm' style={{ background: item.color }} />{item.label}</span>)}
				<span className='ml-auto font-medium text-primary'>{selectedLabel}</span>
				{(dateFrom || dateTo) && <button type='button' onClick={() => onRangeChange()} className='text-brand flex items-center gap-1'><RotateCcw size={11} />重置</button>}
			</div>

			<div className='pb-2'>
				<div>
					<div className='grid h-64 grid-cols-[48px_minmax(0,1fr)]'>
						<div className='relative mb-7'>
							{ticks.map((tick, index) => <span key={index} className='text-secondary absolute right-2 text-[10px] tabular-nums' style={{ top: `${index * 25}%`, transform: index === 0 ? undefined : index === ticks.length - 1 ? 'translateY(-100%)' : 'translateY(-50%)' }}>{formatAxis(tick)}</span>)}
						</div>
						<div className='relative mb-7 border-b border-border'>
							{ticks.map((_, index) => <span key={index} className='absolute inset-x-0 border-t border-dashed border-border/60' style={{ top: `${index * 25}%` }} />)}
							{visible.length ? <MainBars data={visible} maximum={maximum} labelStride={labelStride} /> : <div className='text-secondary flex h-full items-center justify-center text-xs'>当前范围没有 Token</div>}
						</div>
					</div>
					{timeline.length > 0 && <div className='grid grid-cols-[48px_minmax(0,1fr)]'>
						<div />
						<RangeBrush data={timeline} dateFrom={dateFrom} dateTo={dateTo} onChange={onRangeChange} />
					</div>}
				</div>
			</div>
		</div>
	)
}
