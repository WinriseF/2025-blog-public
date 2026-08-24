'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SessionCompressionRecord, SessionCompressionRecordKind, SessionCompressionTurn } from '@/lib/codex-session/types'
import { formatBytes } from './format'
import { TimelineBrush, type TimelineRange } from './timeline-brush'

type LaneId = 'input' | 'model' | 'tools' | 'events'

const LANES: Array<{ id: LaneId; label: string; y: number }> = [
	{ id: 'input', label: 'INPUT / CONTEXT', y: 34 },
	{ id: 'model', label: 'MODEL', y: 58 },
	{ id: 'tools', label: 'TOOLS', y: 82 },
	{ id: 'events', label: 'EVENTS', y: 106 }
]

export const COMPRESSION_KIND: Record<SessionCompressionRecordKind, { label: string; color: string }> = {
	system: { label: 'SYSTEM', color: '#94a3b8' },
	developer: { label: 'DEVELOPER', color: '#06b6d4' },
	user: { label: 'USER', color: '#3b82f6' },
	assistant: { label: 'ASSISTANT', color: '#8b5cf6' },
	reasoning: { label: 'REASONING', color: '#d946ef' },
	'tool-call': { label: 'TOOL', color: '#f97316' },
	'tool-result': { label: 'RESULT', color: '#f59e0b' },
	context: { label: 'CONTEXT', color: '#10b981' },
	token: { label: 'TOKEN', color: '#0ea5e9' },
	event: { label: 'EVENT', color: '#6366f1' },
	metadata: { label: 'META', color: '#71717a' },
	compaction: { label: 'COMPACT', color: '#f43f5e' },
	unknown: { label: 'OTHER', color: '#64748b' },
	invalid: { label: 'INVALID', color: '#ef4444' }
}

function laneFor(kind?: SessionCompressionRecordKind): LaneId {
	if (kind === 'reasoning' || kind === 'assistant') return 'model'
	if (kind === 'tool-call' || kind === 'tool-result') return 'tools'
	if (kind === 'token' || kind === 'event' || kind === 'compaction' || kind === 'invalid') return 'events'
	return 'input'
}

type PositionedNode = { node: SessionCompressionRecord; x: number; y: number; width: number }

function buildLayout(turns: SessionCompressionTurn[]) {
	const laneY = new Map(LANES.map(lane => [lane.id, lane.y]))
	const nodes: PositionedNode[] = []
	const bands: Array<{ turn: SessionCompressionTurn; x: number; width: number }> = []
	let x = 12
	for (const turn of turns) {
		const start = x
		for (const node of turn.records) {
			const width = Math.min(46, Math.max(10, 8 + Math.log2(Math.max(node.byteSize, 1) / 256 + 1) * 5))
			nodes.push({ node, x, y: laneY.get(laneFor(node.kind)) ?? 34, width })
			x += width + 3
		}
		bands.push({ turn, x: start, width: Math.max(x - start - 3, 30) })
		x += 10
	}
	return { nodes, bands, width: Math.max(x, 880) }
}

export function SessionCompressionGraph({ turns, selected }: { turns: SessionCompressionTurn[]; selected: Set<string> }) {
	const layout = useMemo(() => buildLayout(turns), [turns])
	const records = layout.nodes.map(item => item.node)
	const visibleKinds = Object.entries(COMPRESSION_KIND).filter(([kind]) => records.some(node => (node.kind ?? 'unknown') === kind))
	const [range, setRange] = useState<TimelineRange>([0, 1])
	useEffect(() => setRange([0, Math.min(1, Math.max(0.02, 900 / layout.width))]), [layout.width])
	const viewStart = range[0] * layout.width
	const viewWidth = Math.max((range[1] - range[0]) * layout.width, 1)
	const brushSegments = layout.nodes.map(({ node, x, y, width }) => ({
		id: node.id,
		x,
		width,
		y: 4 + (y / 132) * 27,
		height: 4,
		color: COMPRESSION_KIND[node.kind ?? 'unknown'].color,
		opacity: selected.has(node.id) ? 0.2 : 0.7
	}))

	return <section className='border-y border-border'>
		<header className='flex flex-wrap items-end justify-between gap-3 border-b border-border px-3 py-3'>
			<div><h2 className='text-xs font-semibold'>Session 图</h2><p className='text-secondary mt-1 text-[10px]'>从左到右为真实记录顺序；下方拖动窗口浏览完整 Session</p></div>
			<div className='text-secondary flex flex-wrap justify-end gap-x-3 gap-y-1 text-[8px]'>
				{visibleKinds.map(([kind, meta]) => <span key={kind}><i className='mr-1 inline-block size-1.5 rounded-sm' style={{ backgroundColor: meta.color }} />{meta.label}</span>)}
			</div>
		</header>

		<div className='grid grid-cols-[92px_minmax(0,1fr)]'>
			<div className='relative border-r border-border' style={{ height: 132 }}>
				<div className='text-secondary absolute top-2 right-3 text-[8px]'>TURN</div>
				{LANES.map(lane => <div key={lane.id} className='text-secondary absolute inset-x-0 flex h-5 items-center justify-end pr-3 text-[7px] font-semibold tracking-wide' style={{ top: lane.y - 2 }}>{lane.label}</div>)}
			</div>
			<div className='overflow-hidden'>
				<svg viewBox={`${viewStart} 0 ${viewWidth} 132`} width='100%' height={132} preserveAspectRatio='none' className='block bg-foreground/[0.012]' role='img' aria-label='Session 内容顺序图当前窗口'>
					{LANES.map(lane => <line key={lane.id} x1={0} x2={layout.width} y1={lane.y + 8} y2={lane.y + 8} stroke='currentColor' className='text-border' strokeOpacity={0.65} />)}
					{layout.bands.map((band, index) => <g key={band.turn.id}>
						<rect x={band.x - 3} y={2} width={band.width + 6} height={126} fill={index % 2 ? 'currentColor' : 'transparent'} className='text-foreground' fillOpacity={0.02} />
						<line x1={band.x - 3} x2={band.x - 3} y1={2} y2={128} stroke='currentColor' className='text-border' strokeOpacity={0.65} />
						<title>{band.turn.label}</title>
					</g>)}
					{layout.nodes.map(({ node, x, y, width }) => {
						const kind = node.kind ?? 'unknown'
						const isSelected = selected.has(node.id)
						return <g key={node.id} className='cursor-pointer' onClick={() => document.getElementById(`compression-${node.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
							<rect x={x} y={y} width={width} height={16} rx={2} fill={COMPRESSION_KIND[kind].color} fillOpacity={isSelected ? 0.18 : 0.9} stroke={isSelected ? '#f43f5e' : 'transparent'} strokeWidth={2} />
							{isSelected && <line x1={x + 2} x2={x + width - 2} y1={y + 14} y2={y + 2} stroke='#f43f5e' strokeWidth={1} />}
							<title>{`${COMPRESSION_KIND[kind].label} · ${node.label}\n${node.detail ?? ''}\n${formatBytes(node.byteSize)}`}</title>
						</g>
					})}
				</svg>
			</div>
		</div>
		<TimelineBrush totalWidth={layout.width} range={range} segments={brushSegments} onChange={setRange} />
	</section>
}
