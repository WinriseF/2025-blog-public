import type { PerformanceMetrics } from '@/lib/codex-session/types'
import { formatNumber } from './format'

function formatMilliseconds(value?: number) {
	if (value === undefined) return '不可用'
	if (value < 1000) return `${Math.round(value)} ms`
	if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
	if (value < 3_600_000) return `${(value / 60_000).toFixed(1)} 分`
	return `${(value / 3_600_000).toFixed(1)} 小时`
}

export function PerformanceStats({ metrics }: { metrics: PerformanceMetrics }) {
	const stats = [
		['首响应 P50', formatMilliseconds(metrics.firstResponseP50Ms)],
		['首响应 P95', formatMilliseconds(metrics.firstResponseP95Ms)],
		['首响应平均', formatMilliseconds(metrics.firstResponseAverageMs)],
		['平均回合耗时', formatMilliseconds(metrics.averageTurnDurationMs)],
		['端到端 Output/s', metrics.outputTokensPerSecond === undefined ? '不可用' : metrics.outputTokensPerSecond.toFixed(1)],
		['Output / 模型步骤', metrics.requestCount ? formatNumber(Math.round(metrics.outputTokens / metrics.requestCount)) : '不可用']
	]

	return <section className='mt-4 border-y border-border'>
		<div className='flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2'>
			<h2 className='text-xs font-medium'>响应性能</h2>
			<span className='text-secondary text-[10px]'>{metrics.firstResponseCount} / {metrics.turnCount} 个回合可计算首响应</span>
		</div>
		<div className='grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6'>
			{stats.map(([label, value], index) => <div key={label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'xl:border-l xl:border-border' : ''}`}>
				<p className='text-secondary truncate text-[10px]'>{label}</p>
				<p className='mt-1 truncate text-sm font-semibold tabular-nums'>{value}</p>
			</div>)}
		</div>
		<p className='text-secondary border-t border-border px-3 py-2 text-[10px] leading-4'>首响应和回合耗时优先采用 task_complete 的直接记录，缺失时再关联日志时间戳；端到端 Output/s 包含推理、工具执行和等待，并非模型纯生成 TPS。</p>
	</section>
}
