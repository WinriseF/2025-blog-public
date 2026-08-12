'use client'

import dynamic from 'next/dynamic'
import type { SessionTokenUsage } from '@/lib/codex-session/types'
import type { DetailSelection } from './detail-panel'
import { formatDate, formatNumber } from './format'

const TokenChart = dynamic(() => import('./token-chart'), { ssr: false, loading: () => <div className='text-secondary flex h-72 items-center justify-center text-xs'>正在加载图表...</div> })

export function TokenView({ usage, onSelect }: { usage: SessionTokenUsage; onSelect: (selection: DetailSelection) => void }) {
	if (usage.status === 'missing') return <div className='text-secondary flex min-h-72 items-center justify-center border-y border-border px-5 text-center'>此 Session 没有记录 Token 用量</div>

	const total = usage.total
	const requests = usage.samples.length
	const average = requests ? Math.round(usage.samples.reduce((sum, sample) => sum + sample.total, 0) / requests) : 0
	const peak = usage.samples.reduce((best, sample) => sample.total > best.total ? sample : best, usage.samples[0] ?? { total: 0 })
	const cacheRate = total?.input ? (total.cachedInput / total.input) * 100 : 0
	const contextWindow = usage.contextWindow ?? [...usage.samples].reverse().find(sample => sample.contextWindow)?.contextWindow
	const contextRate = contextWindow ? Math.min((peak.total / contextWindow) * 100, 100) : undefined
	const listedSamples = usage.samples.slice(-200)

	return (
		<div className='space-y-5'>
			{usage.status === 'invalid' && <div className='border-l-2 border-rose-400 bg-rose-400/5 px-4 py-3 text-xs leading-5 text-rose-500'>累计 Token 曾出现下降，因此隐藏 Session 总量；下方仍展示可确认的请求级样本。</div>}
			{usage.scope === 'possibly-inherited' && <div className='border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-600'>该 Session 来自 fork / subagent，累计值可能包含父 Session 的继承前缀。</div>}

			<div className='grid grid-cols-2 border-y border-border sm:grid-cols-4 xl:grid-cols-7'>
				{[
					['累计总量', total ? formatNumber(total.total) : '不可用'],
					['Input', total ? formatNumber(total.input) : '不可用'],
					['Output', total ? formatNumber(total.output) : '不可用'],
					['缓存率', total ? `${cacheRate.toFixed(1)}%` : '不可用'],
					['有效请求', formatNumber(requests)],
					['请求平均', formatNumber(average)],
					['请求峰值', formatNumber(peak.total)]
				].map(([label, value], index) => <div key={label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}>
					<p className='text-secondary truncate text-[10px]'>{label}</p>
					<p className='mt-1 truncate text-base font-semibold'>{value}</p>
				</div>)}
			</div>

			{total && <div className='grid gap-3 text-xs md:grid-cols-2'>
				<div className='border-l-2 border-brand bg-background/20 px-4 py-3'>Fresh input {formatNumber(total.freshInput)} · Cached {formatNumber(total.cachedInput)} · Cache write {formatNumber(total.cacheWriteInput)}</div>
				<div className='border-l-2 border-amber-400 bg-background/20 px-4 py-3'>Reasoning output {formatNumber(total.reasoningOutput)}，属于 Output 子集，不重复计入总量。</div>
			</div>}

			{contextRate !== undefined && contextWindow && <div className='border-y border-border py-4'>
				<div className='flex justify-between gap-3 text-xs'><span>单次峰值 / 上下文窗口</span><span>{formatNumber(peak.total)} / {formatNumber(contextWindow)}</span></div>
				<div className='mt-3 h-2 overflow-hidden rounded-full bg-border/50'><div className='bg-brand h-full rounded-full' style={{ width: `${contextRate}%` }} /></div>
			</div>}

			<div className='border-y border-border py-3'>
				<div className='mb-2 flex items-center justify-between px-1'><h3 className='font-semibold'>请求级走势</h3><span className='text-secondary text-xs'>{formatNumber(requests)} 个有效样本</span></div>
				<TokenChart samples={usage.samples} />
			</div>

			<div className='max-h-72 overflow-auto border-t border-border pr-1'>
				{usage.samples.length > listedSamples.length && <p className='text-secondary px-1 pb-1 text-xs'>列表展示最近 {formatNumber(listedSamples.length)} 个请求，图表覆盖全部样本。</p>}
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
