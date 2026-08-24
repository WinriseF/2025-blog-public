'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RequestActivity, SessionActivity, ToolActivity } from '@/lib/codex-session/types'
import { formatDurationMs, formatNumber, toolCategoryColors } from './format'
import { TimelineBrush, type TimelineRange } from './timeline-brush'

const WIDTH = 1000
const HEIGHT = 104
const LANES = [
	{ label: 'INPUT', y: 34 },
	{ label: 'MODEL', y: 58 },
	{ label: 'TOOLS', y: 82 }
] as const

function timeMs(value?: string) {
	if (!value) return
	const time = new Date(value).getTime()
	return Number.isFinite(time) ? time : undefined
}

function requestRange(request: RequestActivity) {
	const end = timeMs(request.timestamp)
	const recordedStart = timeMs(request.startedAt)
	const start = recordedStart ?? (end !== undefined && request.spanMs !== undefined ? end - request.spanMs : end)
	return { start, end: end ?? (start !== undefined && request.spanMs !== undefined ? start + request.spanMs : start) }
}

function toolRange(tool: ToolActivity) {
	const start = timeMs(tool.startedAt)
	const recordedEnd = timeMs(tool.endedAt)
	return { start, end: recordedEnd ?? (start !== undefined && tool.durationMs !== undefined ? start + tool.durationMs : start) }
}

export function ActivityWaterfall({ activity, onTool }: { activity: SessionActivity; onTool: (tool: ToolActivity) => void }) {
	const layout = useMemo(() => {
		const requests = activity.requests.map(request => ({ request, ...requestRange(request) }))
		const tools = activity.tools.filter(tool => tool.logical).map(tool => ({ tool, ...toolRange(tool) }))
		const times = [...requests.flatMap(item => [item.start, item.end]), ...tools.flatMap(item => [item.start, item.end])].filter((time): time is number => time !== undefined)
		const start = times.length ? Math.min(...times) : 0
		const end = times.length ? Math.max(...times) : 0
		const duration = times.length > 1 && end > start ? end - start : undefined
		const scaleDuration = duration ?? 1
		const sequenceMin = Math.min(...activity.requests.map(item => item.sequence), ...activity.tools.map(item => item.sequence), 0)
		const sequenceMax = Math.max(...activity.requests.map(item => item.sequence), ...activity.tools.map(item => item.sequence), 1)
		const x = (time: number | undefined, sequence: number) => {
			const ratio = time !== undefined && duration !== undefined ? (time - start) / scaleDuration : (sequence - sequenceMin) / Math.max(sequenceMax - sequenceMin, 1)
			return 8 + Math.min(Math.max(ratio, 0), 1) * (WIDTH - 16)
		}
		return { requests, tools, start, end, duration, x }
	}, [activity])

	const turns = useMemo(() => {
		const seen = new Set<string>()
		return layout.requests.flatMap(item => {
			const key = item.request.turnId ?? '__unknown__'
			if (seen.has(key)) return []
			seen.add(key)
			return [{ key, x: layout.x(item.start, item.request.sequence), label: key === '__unknown__' ? 'Turn ?' : `Turn ${seen.size}` }]
		})
	}, [layout])
	const [range, setRange] = useState<TimelineRange>([0, 1])
	useEffect(() => {
		const itemCount = activity.requests.length + layout.tools.length
		setRange([0, Math.min(1, Math.max(0.08, 36 / Math.max(itemCount, 1)))])
	}, [activity.requests.length, layout.tools.length])
	const viewStart = range[0] * WIDTH
	const viewWidth = Math.max((range[1] - range[0]) * WIDTH, 1)
	const visibleTurns = turns.filter(turn => turn.x >= viewStart && turn.x <= viewStart + viewWidth)
	const brushSegments = [
		...layout.requests.map(({ request, start, end }) => {
			const x = layout.x(start, request.sequence)
			return { id: `request-${request.id}`, x, width: Math.max(layout.x(end, request.sequence) - x, 2), y: 11, height: 8, color: request.reasoningOutputTokens > 0 ? '#8b5cf6' : '#f59e0b', opacity: 0.7 }
		}),
		...layout.tools.map(({ tool, start, end }) => {
			const x = layout.x(start, tool.sequence)
			return { id: `tool-${tool.id}`, x, width: Math.max(layout.x(end, tool.sequence) - x, 2), y: 22, height: 8, color: toolCategoryColors[tool.category], opacity: 0.75 }
		})
	]

	return <section className='border-y border-border'>
		<header className='flex flex-wrap items-end justify-between gap-3 border-b border-border px-3 py-3'>
			<div><h2 className='text-xs font-semibold'>Session 活动瀑布图</h2><p className='text-secondary mt-1 text-[10px]'>类似 Network 时间轴，完整 Session 自动压缩到当前宽度</p></div>
			<div className='text-secondary flex flex-wrap gap-x-4 gap-y-1 text-[9px]'><span><i className='mr-1 inline-block size-2 bg-blue-500' />输入边界</span><span><i className='mr-1 inline-block size-2 bg-violet-500' />含推理模型步骤</span><span><i className='mr-1 inline-block size-2 bg-amber-400' />普通模型步骤</span><span><i className='mr-1 inline-block size-2 bg-sky-500' />工具执行</span></div>
		</header>
		<div className='grid grid-cols-[72px_minmax(0,1fr)]'>
			<div className='relative border-r border-border' style={{ height: HEIGHT }}>
				<div className='text-secondary absolute top-2 right-2 text-[7px]'>TURNS</div>
				{LANES.map(lane => <div key={lane.label} className='text-secondary absolute inset-x-0 flex h-4 items-center justify-end pr-2 text-[7px] font-semibold' style={{ top: lane.y - 1 }}>{lane.label}</div>)}
			</div>
			<div className='relative overflow-hidden'>
				<svg viewBox={`${viewStart} 0 ${viewWidth} ${HEIGHT}`} width='100%' height={HEIGHT} preserveAspectRatio='none' className='block bg-foreground/[0.012]' role='img' aria-label='Session 模型步骤与工具活动瀑布图当前窗口'>
					{LANES.map(lane => <line key={lane.label} x1={0} x2={WIDTH} y1={lane.y + 7} y2={lane.y + 7} stroke='currentColor' className='text-border' strokeOpacity={0.7} />)}
					{turns.map(turn => <line key={turn.key} x1={turn.x} x2={turn.x} y1={3} y2={HEIGHT} stroke='currentColor' className='text-border' strokeOpacity={0.8} />)}
				{layout.requests.map(({ request, start, end }) => {
					const startX = layout.x(start, request.sequence)
					const endX = layout.x(end, request.sequence)
					const width = Math.max(endX - startX, 2)
					const color = request.reasoningOutputTokens > 0 ? '#8b5cf6' : '#f59e0b'
					return <g key={request.id}>
						<rect x={startX} y={34} width={Math.max(Math.min(width, 4), 2)} height={14} rx={1} fill='#3b82f6'><title>{`模型步骤输入边界 · #${request.sequence}`}</title></rect>
						<rect x={startX} y={58} width={width} height={14} rx={2} fill={color} fillOpacity={0.9}><title>{`Output ${formatNumber(request.outputTokens)} · 推理 ${formatNumber(request.reasoningOutputTokens)} · ${formatDurationMs(request.spanMs)}`}</title></rect>
					</g>
				})}
				{layout.tools.map(({ tool, start, end }) => {
					const startX = layout.x(start, tool.sequence)
					const width = Math.max(layout.x(end, tool.sequence) - startX, 2)
					return <g key={tool.id} className='cursor-pointer' onClick={() => onTool(tool)}><rect x={startX} y={82} width={width} height={14} rx={2} fill={toolCategoryColors[tool.category]} fillOpacity={tool.status === 'completed' ? 0.9 : 0.55} /><title>{`${tool.name} · ${formatDurationMs(tool.durationMs)} · ${tool.status}`}</title></g>
				})}
				</svg>
				<div className='pointer-events-none absolute inset-x-0 top-1 h-4 overflow-hidden'>
					{visibleTurns.map(turn => <span key={turn.key} className='text-secondary absolute max-w-16 truncate text-[8px]' style={{ left: `${((turn.x - viewStart) / viewWidth) * 100}%` }}>{turn.label}</span>)}
				</div>
			</div>
		</div>
		<TimelineBrush totalWidth={WIDTH} range={range} segments={brushSegments} onChange={setRange} />
		<footer className='text-secondary flex justify-between border-t border-border px-3 py-2 text-[9px]'><span>{formatNumber(activity.requests.length)} 个模型步骤 · {formatNumber(layout.tools.length)} 个逻辑工具</span><span>{formatDurationMs(layout.duration)}</span></footer>
	</section>
}
