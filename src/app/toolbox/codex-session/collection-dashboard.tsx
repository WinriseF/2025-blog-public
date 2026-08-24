'use client'

import { useMemo } from 'react'
import { AlertTriangle, CalendarDays, FilePlus2, FolderKanban, RotateCcw } from 'lucide-react'
import { SelectMenu, type SelectMenuOption } from '@/components/select-menu'
import { buildCollectionAnalytics, localDateKey, projectLabel } from '@/lib/codex-session/collection'
import type { SessionBatchFailure, SessionCollectionFilters, SessionSummary } from '@/lib/codex-session/types'
import CollectionTokenChart from './collection-token-chart'
import { formatCompactNumber, formatDate, formatDurationMs, formatNumber, formatPercent } from './format'
import { MetricLabel } from './metric-help'
import { PerformanceStats } from './performance-stats'
import ProjectTokenChart from './project-token-chart'
import { VirtualList } from './virtual-list'

function formatDuration(start?: string, end?: string) {
	if (!start || !end) return '时长未知'
	const duration = new Date(end).getTime() - new Date(start).getTime()
	if (!Number.isFinite(duration) || duration < 0) return '时长未知'
	const minutes = Math.round(duration / 60_000)
	if (minutes < 60) return `${minutes} 分钟跨度`
	const hours = Math.floor(minutes / 60)
	return `${hours} 小时 ${minutes % 60} 分钟跨度`
}

function sessionToken(session: SessionSummary) {
	const attributed = session.tokenUsage.samples.reduce((total, sample) => total + sample.total, 0)
	return session.tokenUsage.total?.total ?? (attributed || undefined)
}

type CollectionDashboardProps = {
	sessions: SessionSummary[]
	failures: SessionBatchFailure[]
	ignoredFiles: number
	onSelect: (session: SessionSummary) => void
	onClear: () => void
	onFiles: (files: File[]) => void
	filters: SessionCollectionFilters
	onFiltersChange: (filters: SessionCollectionFilters) => void
}

export function CollectionDashboard({ sessions, failures, ignoredFiles, onSelect, onClear, onFiles, filters, onFiltersChange }: CollectionDashboardProps) {
	const projects = useMemo(() => [...new Set(sessions.flatMap(session => session.projectKeys))].sort(), [sessions])
	const models = useMemo(() => [...new Set(sessions.flatMap(session => [...session.meta.models, ...session.tokenUsage.samples.flatMap(sample => sample.model ? [sample.model] : [])]))].sort(), [sessions])
	const projectOptions = useMemo<readonly SelectMenuOption<string>[]>(() => [
		{ value: '', label: '全部项目' },
		...projects.map(project => ({ value: project, label: projectLabel(project) }))
	], [projects])
	const modelOptions = useMemo<readonly SelectMenuOption<string>[]>(() => [
		{ value: '', label: '全部模型' },
		...models.map(model => ({ value: model, label: model }))
	], [models])
	const analytics = useMemo(() => buildCollectionAnalytics(sessions, filters), [filters, sessions])
	const chartAnalytics = useMemo(() => buildCollectionAnalytics(sessions, { projectKey: filters.projectKey, model: filters.model }), [filters.model, filters.projectKey, sessions])
	const timeline = useMemo(() => [...analytics.sessions]
		.sort((left, right) => (right.meta.startedAt ?? '').localeCompare(left.meta.startedAt ?? ''))
		.map((session, index, list) => ({
			session,
			day: localDateKey(session.meta.startedAt) ?? '日期未知',
			showDay: index === 0 || localDateKey(list[index - 1].meta.startedAt) !== localDateKey(session.meta.startedAt)
		})), [analytics.sessions])
	const issueCount = failures.length + ignoredFiles
	const partialToolTiming = analytics.activity.toolExecutionCount > 0 && (analytics.activity.toolTimeCoverage ?? 0) < 1
	const stats: Array<{ label: string; value: string; help?: string }> = [
		{ label: '总 Token', value: formatCompactNumber(analytics.total.total), help: '当前筛选范围内记录的 Input 与 Output Token 总量；缓存 Input 已包含在 Input 中，不会重复相加。' },
		{ label: 'Session', value: formatNumber(analytics.sessions.length) },
		{ label: '活跃天数', value: formatNumber(analytics.activeDays) },
		{ label: '项目', value: formatNumber(analytics.projects.length) },
		{ label: '模型步骤', value: formatNumber(analytics.requestCount), help: '有效 token_count 样本数，近似 Codex 调用模型生成一次结果的次数；一个用户回合通常包含多个模型步骤。' },
		{ label: '缓存率', value: analytics.total.input ? `${((analytics.total.cachedInput / analytics.total.input) * 100).toFixed(1)}%` : '不可用', help: 'Cached Input Token 占全部 Input Token 的比例。' },
		{ label: '推理 Token / Output', value: formatPercent(analytics.activity.reasoningShareOfOutput), help: 'Reasoning Output Token 占全部 Output Token 的比例。工具调用参数属于非推理 Output，不计入推理 Token。' },
		{ label: '工具调用步骤率', value: formatPercent(analytics.activity.toolRequestRate), help: '产生至少一次逻辑工具调用的模型步骤，占全部有效模型步骤的比例；同一步骤调用多个工具仍只计一次。' },
		{ label: '工具耗时 / 步骤墙钟', value: formatPercent(analytics.activity.toolTimeShare), help: '当前筛选命中的模型步骤中，可确认工具执行区间的并集占步骤墙钟时间的比例；分子和分母使用相同的日期、项目及模型筛选。' },
		{ label: '累计工具墙钟', value: formatDurationMs(analytics.activity.toolDurationMs || undefined), help: '当前筛选范围内累计确认的工具执行墙钟时间，不是 CPU 时间、Token 成本或日历跨度。' }
	]

	const updateFilter = <K extends keyof SessionCollectionFilters,>(key: K, value: SessionCollectionFilters[K]) => onFiltersChange({ ...filters, [key]: value })

	return (
		<div className='max-sm:px-4'>
			<header className='border-b border-border pb-6'>
				<div className='flex flex-wrap items-start justify-between gap-5'>
					<div>
						<p className='text-brand text-xs tracking-[0.2em] uppercase'>Codex Session Timeline</p>
						<h1 className='mt-2 text-2xl font-semibold'>多 Session 时间线</h1>
						<p className='text-secondary mt-2 text-sm'>按模型步骤增量汇总 Token，并保留每次 Session 的完整审计下钻。</p>
					</div>
					<div className='flex flex-wrap gap-2 text-xs'>
						<label className='hover:border-brand/45 flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-2 transition'>
							<input type='file' accept='.jsonl,application/x-ndjson' multiple className='hidden' onClick={event => (event.currentTarget.value = '')} onChange={event => event.target.files && onFiles(Array.from(event.target.files))} />
							<FilePlus2 size={14} /> 重新导入
						</label>
						<button type='button' onClick={onClear} className='hover:border-rose-400/50 hover:text-rose-500 flex items-center gap-1.5 rounded-full border border-border px-3 py-2 transition'>
							<RotateCcw size={14} /> 清空
						</button>
					</div>
				</div>

				<div className='mt-5 grid grid-cols-2 border-y border-border sm:grid-cols-5 xl:grid-cols-10'>
					{stats.map((item, index) => <div key={item.label} className={`min-w-0 px-3 py-3 ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}>
						<p className='text-secondary text-[10px]'><MetricLabel label={item.label} help={item.help} /></p>
						<p className='mt-1 truncate text-base font-semibold' title={item.label === '总 Token' ? formatNumber(analytics.total.total) : undefined}>{item.value}</p>
					</div>)}
				</div>
				<PerformanceStats metrics={analytics.performance} />
			</header>

			{(issueCount > 0 || analytics.unallocatedTokens > 0 || partialToolTiming) && <div className='mt-4 border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-700'>
				<div className='flex items-start gap-2'><AlertTriangle size={15} className='mt-0.5 shrink-0' /><div>
					{analytics.unallocatedTokens > 0 && <p>其中 {formatNumber(analytics.unallocatedTokens)} Token 缺少模型步骤级细分，已按 Session 的结束时间和最终项目计入分布。</p>}
					{partialToolTiming && <p>工具耗时覆盖率为 {formatPercent(analytics.activity.toolTimeCoverage)}；工具耗时 / 步骤墙钟只统计能够确认时间区间的执行批次。</p>}
					{issueCount > 0 && <p>{failures.length} 个文件失败、{ignoredFiles} 个非 JSONL 文件被忽略。</p>}
				</div></div>
				{failures.length > 0 && <details className='mt-2 pl-6'><summary className='cursor-pointer'>查看失败文件</summary><ul className='mt-2 space-y-1 font-mono text-[11px]'>{failures.map(file => <li key={file.key}>{file.relativePath ?? file.name}：{file.message}</li>)}</ul></details>}
			</div>}

			<section className='mt-6 grid items-start gap-3 border-y border-border py-4 md:grid-cols-2'>
				<SelectMenu value={filters.projectKey ?? ''} options={projectOptions} onChange={value => updateFilter('projectKey', value || undefined)} ariaLabel='筛选项目' label='项目' className='self-end' />
				<SelectMenu value={filters.model ?? ''} options={modelOptions} onChange={value => updateFilter('model', value || undefined)} ariaLabel='筛选模型' label='模型' className='self-end' />
			</section>

			<div className='mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]'>
				<section className='min-w-0 border-y border-border py-3'>
					<div className='mb-2 flex items-center justify-between gap-3 px-1'><h2 className='font-semibold'>Token 时间分布</h2><span className='text-secondary text-xs'>{analytics.daily.length} / {chartAnalytics.daily.length} 个活动日期</span></div>
					{chartAnalytics.daily.length ? <CollectionTokenChart data={chartAnalytics.daily} dateFrom={filters.dateFrom} dateTo={filters.dateTo} onRangeChange={(dateFrom, dateTo) => onFiltersChange({ ...filters, dateFrom, dateTo })} /> : <div className='text-secondary flex h-72 items-center justify-center text-xs'>没有可按日期归属的 Token 样本</div>}
				</section>
				<section className='min-w-0 border-y border-border py-3'>
					<div className='mb-2 flex items-center justify-between gap-3 px-1'><h2 className='font-semibold'>项目分布</h2><span className='text-secondary text-xs'>前 {Math.min(analytics.projects.length, 12)} 个项目</span></div>
					{analytics.projects.length ? <ProjectTokenChart data={analytics.projects} /> : <div className='text-secondary flex h-72 items-center justify-center text-xs'>没有可按项目归属的 Token 样本</div>}
				</section>
			</div>

			<section className='mt-8'>
				<div className='mb-3 flex items-center justify-between gap-3'><div className='flex items-center gap-2'><CalendarDays size={17} className='text-brand' /><h2 className='font-semibold'>Session 时间轴</h2></div><span className='text-secondary text-xs'>{formatNumber(timeline.length)} 个 Session</span></div>
				<VirtualList
					items={timeline}
					estimateSize={118}
					getKey={item => item.session.key}
					empty='当前筛选范围内没有 Session'
					renderItem={({ session, day, showDay }) => <div className='grid grid-cols-[92px_minmax(0,1fr)] border-b border-border max-sm:grid-cols-1'>
						<div className='text-secondary px-3 py-4 text-xs'>{showDay ? day : ''}</div>
						<button type='button' onClick={() => onSelect(session)} className='hover:bg-background/25 min-w-0 border-l border-border px-4 py-4 text-left transition max-sm:border-l-0 max-sm:pt-0'>
							<div className='flex min-w-0 items-start gap-3'>
								<span className='text-brand mt-0.5 flex size-8 shrink-0 items-center justify-center'><FolderKanban size={16} /></span>
								<div className='min-w-0 flex-1'>
									<div className='flex flex-wrap items-center gap-x-3 gap-y-1'><p className='truncate font-medium'>{session.projectKeys.map(projectLabel).join(' / ')}</p><span className='text-brand ml-auto font-mono text-xs' title={`${formatNumber(sessionToken(session))} Token`}>{formatCompactNumber(sessionToken(session))} Token</span></div>
									<p className='text-secondary mt-1 truncate font-mono text-[10px]' title={session.relativePath ?? session.source.name}>{session.relativePath ?? session.source.name}</p>
									<div className='text-secondary mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]'><span>{formatDate(session.meta.startedAt)}</span><span>{formatDuration(session.meta.startedAt, session.meta.endedAt)}</span><span>{session.meta.model ?? '未知模型'}</span><span>{session.requestCount} 个模型步骤</span><span>推理 {formatPercent(session.activity.reasoningShareOfOutput)}</span><span>工具步骤 {formatPercent(session.activity.toolRequestRate)}</span>{session.tokenUsage.scope === 'possibly-inherited' && <span className='text-amber-600'>fork / subagent</span>}{session.warningCount > 0 && <span className='text-rose-500'>{session.warningCount} 个警告</span>}</div>
								</div>
							</div>
						</button>
					</div>}
				/>
			</section>
		</div>
	)
}
