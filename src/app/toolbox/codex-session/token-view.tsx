'use client'

import dynamic from 'next/dynamic'
import type { PerformanceMetrics, SessionTokenUsage } from '@/lib/codex-session/types'
import type { DetailSelection } from './detail-panel'
import { formatCompactNumber, formatDate, formatNumber, formatPercent } from './format'
import { MetricLabel } from './metric-help'
import { PerformanceStats } from './performance-stats'

const TokenChart = dynamic(() => import('./token-chart'), { ssr: false, loading: () => <div className='text-secondary flex h-72 items-center justify-center text-xs'>正在加载图表...</div> })

export function TokenView({ usage, performance, onSelect }: { usage: SessionTokenUsage; performance: PerformanceMetrics; onSelect: (selection: DetailSelection) => void }) {
	if (usage.status === 'missing') return <div className='space-y-5'>
		<PerformanceStats metrics={performance} />
		<div className='text-secondary flex min-h-48 items-center justify-center border-y border-border px-5 text-center'>此 Session 没有记录 Token 用量，输出速度和模型步骤均值不可计算</div>
	</div>

	const total = usage.total
	const requests = usage.samples.length
	const average = requests ? Math.round(usage.samples.reduce((sum, sample) => sum + sample.total, 0) / requests) : 0
	const peak = usage.samples.reduce((best, sample) => sample.total > best.total ? sample : best, usage.samples[0] ?? { total: 0 })
	const cacheRate = total?.input ? (total.cachedInput / total.input) * 100 : 0
	const contextWindow = usage.contextWindow ?? [...usage.samples].reverse().find(sample => sample.contextWindow)?.contextWindow
	const contextRate = contextWindow ? Math.min((peak.total / contextWindow) * 100, 100) : undefined
	const reasoningRate = total?.output ? total.reasoningOutput / total.output : undefined
	const listedSamples = usage.samples.slice(-200)
	const stats: Array<{ label: string; value: string; help?: string }> = [
		{ label: '累计总量', value: total ? formatCompactNumber(total.total) : '不可用', help: 'Session 记录的累计 Input 与 Output Token。' },
		{ label: 'Input', value: total ? formatNumber(total.input) : '不可用' },
		{ label: 'Output', value: total ? formatNumber(total.output) : '不可用', help: '模型产生的全部 Output Token，包含 Reasoning、可见回复和工具调用参数。' },
		{ label: '推理 Token / Output', value: formatPercent(reasoningRate), help: 'Reasoning Output Token 占全部 Output Token 的比例；工具调用参数不属于推理 Token。' },
		{ label: '缓存率', value: total ? `${cacheRate.toFixed(1)}%` : '不可用', help: 'Cached Input Token 占全部 Input Token 的比例。' },
		{ label: '模型步骤', value: formatNumber(requests), help: '有效 token_count 样本数，近似模型生成一次结果的次数；一个用户回合通常包含多个步骤。' },
		{ label: '步骤平均', value: formatNumber(average), help: '所有有效模型步骤的平均 Total Token。' },
		{ label: '步骤峰值', value: formatNumber(peak.total), help: '单个有效模型步骤记录到的最高 Total Token。' }
	]

	return (
		<div className='space-y-5'>
			{usage.status === 'invalid' && <div className='border-l-2 border-rose-400 bg-rose-400/5 px-4 py-3 text-xs leading-5 text-rose-500'>累计 Token 曾出现下降，因此隐藏 Session 总量；下方仍展示可确认的模型步骤样本。</div>}
			{usage.scope === 'possibly-inherited' && <div className='border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-600'>该 Session 来自 fork / subagent，累计值可能包含父 Session 的继承前缀。</div>}

			<div className='grid grid-cols-2 border-y border-border sm:grid-cols-4 xl:grid-cols-8'>
				{stats.map((item, index) => <div key={item.label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}>
					<p className='text-secondary text-[10px]'><MetricLabel label={item.label} help={item.help} /></p>
					<p className='mt-1 truncate text-base font-semibold' title={item.label === '累计总量' ? formatNumber(total?.total) : undefined}>{item.value}</p>
				</div>)}
			</div>
			<PerformanceStats metrics={performance} />

			{total && <div className='grid gap-3 text-xs md:grid-cols-2'>
				<div className='border-l-2 border-brand bg-background/20 px-4 py-3'>Fresh input {formatNumber(total.freshInput)} · Cached {formatNumber(total.cachedInput)} · Cache write {formatNumber(total.cacheWriteInput)}</div>
				<div className='border-l-2 border-amber-400 bg-background/20 px-4 py-3'>Reasoning output {formatNumber(total.reasoningOutput)}，属于 Output 子集，不重复计入总量。</div>
			</div>}

			{contextRate !== undefined && contextWindow && <div className='border-y border-border py-4'>
				<div className='flex justify-between gap-3 text-xs'><span>单次峰值 / 上下文窗口</span><span>{formatNumber(peak.total)} / {formatNumber(contextWindow)}</span></div>
				<div className='mt-3 h-2 overflow-hidden rounded-full bg-border/50'><div className='bg-brand h-full rounded-full' style={{ width: `${contextRate}%` }} /></div>
			</div>}

			<div className='border-y border-border py-3'>
				<div className='mb-2 flex items-center justify-between px-1'><h3 className='font-semibold'>模型步骤走势</h3><span className='text-secondary text-xs'>{formatNumber(requests)} 个有效样本</span></div>
				<TokenChart samples={usage.samples} />
			</div>

			<div className='max-h-72 overflow-auto border-t border-border pr-1'>
				{usage.samples.length > listedSamples.length && <p className='text-secondary px-1 pb-1 text-xs'>列表展示最近 {formatNumber(listedSamples.length)} 个模型步骤，图表覆盖全部样本。</p>}
				{listedSamples.map((sample, offset) => {
					const index = usage.samples.length - listedSamples.length + offset + 1
					return <button key={sample.id} type='button' onClick={() => onSelect({ type: 'token', value: sample })} className='hover:bg-background/25 grid w-full grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-3 border-b border-border px-3 py-3 text-left text-xs transition-colors max-sm:grid-cols-2'>
						<span className='font-medium'>#{index}</span>
						<span>fresh {formatNumber(sample.freshInput)}</span>
						<span>cached {formatNumber(sample.cachedInput)}</span>
						<span>output {formatNumber(sample.output)}</span>
						<span className='text-secondary truncate'>{formatDate(sample.timestamp)}</span>
					</button>
				})}
			</div>
		</div>
	)
}
