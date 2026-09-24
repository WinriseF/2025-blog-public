'use client'

import dynamic from 'next/dynamic'
import { ExternalLink } from 'lucide-react'
import priceCatalog from '@/config/codex-api-pricing.json'
import type { ApiCostEstimate } from '@/lib/codex-session/api-cost'
import { formatNumber, formatUsd } from './format'

const ApiCostChart = dynamic(() => import('./api-cost-chart'), { ssr: false, loading: () => <div className='text-secondary flex h-64 items-center justify-center text-xs'>正在加载费用走势...</div> })

export function ApiCostView({ estimate }: { estimate: ApiCostEstimate }) {
	const parts = [
		{ label: '普通 Input', value: estimate.parts.input, color: 'bg-brand' },
		{ label: '缓存 Input', value: estimate.parts.cachedInput, color: 'bg-emerald-500' },
		{ label: '缓存写入', value: estimate.parts.cacheWriteInput, color: 'bg-violet-500' },
		{ label: 'Output', value: estimate.parts.output, color: 'bg-amber-400' }
	]

	return <section className='border-y border-border px-3 py-4'>
		<div className='flex flex-wrap items-start justify-between gap-4'>
			<div>
				<h2 className='text-xs font-semibold'>API 等价费用估算</h2>
				<p className='mt-2 text-3xl font-semibold tabular-nums text-brand'>{formatUsd(estimate.total)}</p>
				<p className='text-secondary mt-1 text-[11px]'>按 OpenAI Standard API 文本 Token 单价计算，不代表 Codex 实际账单。</p>
			</div>
			<a href={priceCatalog.sourceUrl} target='_blank' rel='noreferrer' className='text-secondary hover:text-brand inline-flex items-center gap-1 text-[11px] transition'>官方价格 <ExternalLink size={12} /></a>
		</div>
		<div className='mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border pt-4 sm:grid-cols-4'>
			{parts.map(part => <div key={part.label} className='min-w-0 text-xs'>
				<p className='text-secondary flex items-center gap-1.5 text-[10px]'><i className={`size-2 shrink-0 rounded-sm ${part.color}`} />{part.label}</p>
				<p className='mt-1 font-semibold tabular-nums'>{formatUsd(part.value)}</p>
			</div>)}
		</div>
		{estimate.steps.length > 1 && <div className='mt-5 border-t border-border pt-4'>
			<div className='mb-2 flex flex-wrap items-center justify-between gap-2 text-xs'><h3 className='font-semibold'>费用走势</h3><span className='text-secondary'>按模型步骤累计 · {formatNumber(estimate.steps.length)} 步</span></div>
			<ApiCostChart steps={estimate.steps} />
		</div>}
		<p className='text-secondary border-t border-border pt-3 text-[10px]'>价格核对：{priceCatalog.verifiedOn} · 美元 / 百万 Token · 仅模型 Token 费用</p>
	</section>
}
