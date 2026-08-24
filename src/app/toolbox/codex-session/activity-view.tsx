'use client'

import { AlertTriangle } from 'lucide-react'
import type { SessionActivity } from '@/lib/codex-session/types'
import type { DetailSelection } from './detail-panel'
import { formatDate, formatDurationMs, formatNumber, formatPercent, statusLabels, toolCategoryLabels } from './format'
import { MetricLabel } from './metric-help'

const CATEGORY_COLORS = {
	shell: '#0ea5e9',
	file: '#22c55e',
	web: '#f59e0b',
	mcp: '#8b5cf6',
	planning: '#ec4899',
	interaction: '#14b8a6',
	collaboration: '#6366f1',
	other: '#94a3b8'
} as const

export function ActivityView({ activity, onSelect }: { activity: SessionActivity; onSelect: (selection: DetailSelection) => void }) {
	const { metrics } = activity
	const outputTokens = metrics.reasoningOutputTokens + metrics.visibleOutputTokens
	const reasoningPercent = metrics.reasoningShareOfOutput ?? 0
	const toolTimePercent = metrics.toolTimeShare ?? 0
	const listedRequests = activity.requests.slice(-160)
	const listedTools = activity.tools.filter(tool => tool.logical).slice(-200)
	const stats: Array<{ label: string; value: string; help?: string }> = [
		{ label: '推理 Token / Output', value: formatPercent(metrics.reasoningShareOfOutput), help: 'Reasoning Output Token 占全部 Output Token 的比例；工具调用参数属于非推理 Output。' },
		{ label: '工具调用步骤率', value: formatPercent(metrics.toolRequestRate), help: '产生至少一次逻辑工具调用的模型步骤，占全部有效模型步骤的比例。' },
		{ label: '工具耗时 / 回合耗时', value: formatPercent(metrics.toolTimeShare), help: '可确认工具执行区间的并集，占累计回合耗时的比例；并行重叠只计一次。' },
		{ label: '逻辑工具调用', value: formatNumber(metrics.logicalToolCallCount), help: '解开 exec 包装后真正调用的工具数量；外层编排包装不会重复计数。' },
		{ label: '工具执行批次', value: formatNumber(metrics.toolExecutionCount), help: '实际执行批次数。一次 exec 批次可以包含多个逻辑工具调用。' },
		{ label: '时间覆盖率', value: formatPercent(metrics.toolTimeCoverage), help: '具有可靠开始、结束或 duration 证据的工具执行批次比例。覆盖不完整时，工具耗时会偏低。' }
	]

	if (!metrics.requestCount && !metrics.logicalToolCallCount) return <div className='text-secondary flex min-h-48 items-center justify-center border-y border-border px-5 text-center'>此 Session 没有可关联的模型步骤或工具活动</div>

	return <div className='space-y-6'>
		<div className='grid grid-cols-2 border-y border-border sm:grid-cols-3 xl:grid-cols-6'>
			{stats.map((item, index) => <div key={item.label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'xl:border-l xl:border-border' : ''}`}>
				<p className='text-secondary text-[10px]'><MetricLabel label={item.label} help={item.help} /></p>
				<p className='mt-1 truncate text-base font-semibold tabular-nums'>{item.value}</p>
			</div>)}
		</div>

		{metrics.toolExecutionCount > 0 && metrics.toolTimeCoverage !== undefined && metrics.toolTimeCoverage < 0.8 && <div className='flex items-start gap-2 border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-700'>
			<AlertTriangle size={15} className='mt-0.5 shrink-0' />
			<span>只有 {formatPercent(metrics.toolTimeCoverage)} 的工具执行批次具有可靠耗时；墙钟占比只统计已确认区间，不能视为完整成本。</span>
		</div>}

		<section className='grid gap-4 lg:grid-cols-2'>
			<div className='border-y border-border px-3 py-4'>
				<div className='flex items-center justify-between gap-3 text-xs'><h2 className='font-semibold'>Output 构成</h2><span className='text-secondary'>{formatNumber(outputTokens)} Token</span></div>
				<div className='mt-4 flex h-4 overflow-hidden rounded-full bg-border/50' aria-label={`思考占 Output ${formatPercent(metrics.reasoningShareOfOutput)}`}>
					{metrics.reasoningOutputTokens > 0 && <span className='h-full bg-violet-500' style={{ width: `${reasoningPercent * 100}%` }} />}
					{metrics.visibleOutputTokens > 0 && <span className='h-full flex-1 bg-amber-400' />}
				</div>
				<div className='text-secondary mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px]'><span><i className='mr-1.5 inline-block size-2 rounded-sm bg-violet-500' />Reasoning {formatNumber(metrics.reasoningOutputTokens)}</span><span><i className='mr-1.5 inline-block size-2 rounded-sm bg-amber-400' />非推理 Output {formatNumber(metrics.visibleOutputTokens)}</span></div>
				<p className='text-secondary mt-2 text-[10px] leading-4'>非推理 Output 包含可见回复、工具调用参数和其他非推理输出。</p>
			</div>

			<div className='border-y border-border px-3 py-4'>
				<div className='flex items-center justify-between gap-3 text-xs'><h2 className='font-semibold'>回合墙钟构成</h2><span className='text-secondary'>{formatDurationMs(metrics.observedDurationMs)}</span></div>
				<div className='mt-4 flex h-4 overflow-hidden rounded-full bg-border/50' aria-label={`工具耗时占回合耗时 ${formatPercent(metrics.toolTimeShare)}`}>
					{metrics.toolDurationMs > 0 && <span className='h-full bg-sky-500' style={{ width: `${toolTimePercent * 100}%` }} />}
					{metrics.nonToolDurationMs > 0 && <span className='h-full flex-1 bg-slate-400/55' />}
				</div>
				<div className='text-secondary mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px]'><span><i className='mr-1.5 inline-block size-2 rounded-sm bg-sky-500' />工具执行 {formatDurationMs(metrics.toolDurationMs)}</span><span><i className='mr-1.5 inline-block size-2 rounded-sm bg-slate-400/55' />非工具时间 {formatDurationMs(metrics.nonToolDurationMs)}</span></div>
				<p className='text-secondary mt-2 text-[10px] leading-4'>非工具时间包含模型响应、运行时与等待；日志不能将其全部证明为“思考时间”。</p>
			</div>
		</section>

		{activity.categories.length > 0 && <section className='border-y border-border py-3'>
			<div className='mb-3 flex items-center justify-between gap-3 px-1'><h2 className='font-semibold'>工具类别</h2><span className='text-secondary text-xs'>按逻辑调用数排序</span></div>
			<div className='space-y-3 px-2'>
				{activity.categories.map(category => {
					const maximum = activity.categories[0]?.callCount || 1
					return <div key={category.category} className='grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 text-xs'>
						<span>{toolCategoryLabels[category.category]}</span>
						<span className='h-2 overflow-hidden rounded-full bg-border/50'><span className='block h-full rounded-full' style={{ width: `${(category.callCount / maximum) * 100}%`, background: CATEGORY_COLORS[category.category] }} /></span>
						<span className='text-secondary min-w-28 text-right tabular-nums'>{formatNumber(category.callCount)} 次 · {formatDurationMs(category.durationMs || undefined)}</span>
					</div>
				})}
			</div>
		</section>}

		{listedRequests.length > 0 && <section>
			<div className='mb-3 flex items-center justify-between gap-3'><h2 className='font-semibold'>模型步骤时间线</h2><span className='text-secondary text-xs'>最近 {formatNumber(listedRequests.length)} / {formatNumber(activity.requests.length)}</span></div>
			<div className='max-h-96 overflow-auto border-t border-border'>
				{listedRequests.map((request, offset) => {
					const index = activity.requests.length - listedRequests.length + offset + 1
					const toolShare = request.spanMs ? Math.min(request.toolDurationMs / request.spanMs, 1) : undefined
					return <div key={request.id} className='grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-3 text-xs max-sm:grid-cols-[42px_minmax(0,1fr)]'>
						<span className='font-medium'>#{index}</span>
						<div className='min-w-0'>
							<div className='flex flex-wrap items-center gap-x-3 gap-y-1'><span>Output {formatNumber(request.outputTokens)}</span><span className='text-violet-500'>思考 {formatPercent(request.reasoningShareOfOutput)}</span><span className='text-secondary'>{request.toolCallCount} 个工具</span></div>
							<div className='mt-2 h-1.5 overflow-hidden rounded-full bg-border/50'>{toolShare !== undefined && <span className='block h-full bg-sky-500' style={{ width: `${toolShare * 100}%` }} />}</div>
						</div>
						<div className='text-secondary text-right text-[10px] max-sm:col-start-2 max-sm:text-left'><p>{formatDate(request.timestamp)}</p><p className='mt-1'>{formatDurationMs(request.spanMs)} · 工具 {formatDurationMs(request.toolDurationMs || undefined)}</p></div>
					</div>
				})}
			</div>
		</section>}

		{listedTools.length > 0 && <section>
			<div className='mb-3 flex items-center justify-between gap-3'><h2 className='font-semibold'>工具调用</h2><span className='text-secondary text-xs'>最近 {formatNumber(listedTools.length)} / {formatNumber(metrics.logicalToolCallCount)}</span></div>
			<div className='max-h-80 overflow-auto border-t border-border'>
				{listedTools.map(tool => <button key={tool.id} type='button' onClick={() => onSelect({ type: 'tool-activity', value: tool })} className='hover:bg-background/25 grid w-full grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border px-3 py-3 text-left text-xs transition-colors'>
					<span className='truncate font-mono'>{tool.name}</span>
					<span style={{ color: CATEGORY_COLORS[tool.category] }}>{toolCategoryLabels[tool.category]}</span>
					<span className='text-secondary tabular-nums'>{statusLabels[tool.status]} · {formatDurationMs(tool.durationMs)}</span>
				</button>)}
			</div>
		</section>}
	</div>
}
