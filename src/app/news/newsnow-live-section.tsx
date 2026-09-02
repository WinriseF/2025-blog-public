'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Flame, Radio, Sparkles } from 'lucide-react'
import type { NewsNowSource } from '@/lib/news'

const NEWSNOW_FOCUS_URL = 'https://newsnow.busiyi.world/c/focus'
const NEWSNOW_FEATURED_SOURCE_IDS = ['github-trending-today', 'ithome', 'juejin', 'sspai', 'zhihu', 'toutiao']

type NewsNowFocusResponse = {
	sourceUrl?: string
	sources?: NewsNowSource[]
	error?: string
}

function formatNewsNowUpdatedTime(updatedTime?: number): string {
	if (!updatedTime) return '刚刚同步'

	return new Intl.DateTimeFormat('zh-CN', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'Asia/Shanghai'
	}).format(new Date(updatedTime))
}

function NewsNowHeader({ expanded, muted }: { expanded: boolean; muted?: boolean }) {
	return (
		<summary className='relative flex cursor-pointer list-none items-center justify-between gap-5 rounded-2xl outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--news-live-accent)]/40 [&::-webkit-details-marker]:hidden'>
			<div className='flex min-w-0 items-start gap-3'>
				<div className='news-live-mark flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl'>
					{muted ? <Radio className='size-6' /> : <Flame className='size-6' />}
				</div>
				<div className='min-w-0'>
					<div className='news-muted text-xs tracking-[0.2em] uppercase'>NewsNow Focus</div>
					<h2 className='mt-1 text-2xl leading-8 font-semibold max-sm:text-xl'>实时热点</h2>
					<p className='news-muted mt-2 max-w-[680px] text-sm leading-6'>聚合 NewsNow 焦点源，补齐日报之外的即时热点脉冲。</p>
				</div>
			</div>

			<span className='news-primary-action flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium max-sm:px-3'>
				<span className='max-sm:hidden'>{expanded ? '收起热点' : '展开热点'}</span>
				<ChevronDown className={`size-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
			</span>
		</summary>
	)
}

function NewsNowMetric({ label, value }: { label: string; value: string | number }) {
	return (
		<div className='news-live-metric flex min-w-0 items-baseline justify-between gap-3 px-4 py-3 first:border-l-0 max-sm:border-l-0 max-sm:first:border-t-0'>
			<span className='news-muted shrink-0 text-sm'>{label}</span>
			<strong className='truncate text-xl leading-none font-semibold max-sm:text-lg'>{value}</strong>
		</div>
	)
}

function NewsNowItemLink({ item, index }: { item: NewsNowSource['items'][number]; index: number }) {
	return (
		<a
			href={item.url}
			target='_blank'
			rel='noopener noreferrer'
			title={item.hover || item.title}
			className='news-live-item group/item grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-200'>
			<span className='news-live-rank mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold'>{index + 1}</span>
			<span className='min-w-0'>
				<span className='news-title line-clamp-2 text-sm leading-5 font-medium transition-colors'>{item.title}</span>
				{item.info && <span className='news-muted mt-1 block truncate text-xs'>{item.info}</span>}
			</span>
			<ExternalLink className='news-muted mt-1 size-3.5 shrink-0 transition-colors group-hover/item:text-[var(--news-accent-strong)]' />
		</a>
	)
}

function NewsNowSourcePanel({ source, index }: { source: NewsNowSource; index: number }) {
	const updatedTime = formatNewsNowUpdatedTime(source.updatedTime)

	return (
		<article className='news-live-source min-w-0 rounded-[24px] p-3.5' style={{ animationDelay: `${180 + index * 50}ms` }}>
			<div className='flex items-start justify-between gap-3 px-1'>
				<div className='min-w-0'>
					<div className='news-muted text-[10px] tracking-[0.18em] uppercase'>{source.status}</div>
					<h3 className='mt-1 truncate text-base font-semibold'>{source.name}</h3>
				</div>
				<div className='flex shrink-0 items-center gap-2'>
					<div className='news-live-time rounded-full px-2.5 py-1 text-[11px] font-medium'>{source.items.length} 条</div>
					<div className='news-live-time rounded-full px-2.5 py-1 text-[11px] font-medium'>{updatedTime}</div>
				</div>
			</div>

			<div className='news-live-items mt-3 space-y-1'>
				{source.items.map((item, itemIndex) => (
					<NewsNowItemLink key={`${source.id}-${item.id}-${item.url}`} item={item} index={itemIndex} />
				))}
			</div>
		</article>
	)
}

function NewsNowSourceChip({ source, sourceUrl }: { source: NewsNowSource; sourceUrl: string }) {
	return (
		<a
			href={source.items[0]?.url || sourceUrl}
			target='_blank'
			rel='noopener noreferrer'
			className='news-live-chip flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200'>
			<span className='max-w-[7rem] truncate'>{source.name}</span>
			<span className='news-muted'>{source.items.length}</span>
		</a>
	)
}

function NewsNowFallback({ message, loading }: { message: string; loading?: boolean }) {
	return (
		<div className='news-live-empty news-muted relative mt-5 rounded-[24px] px-4 py-8 text-center text-sm'>
			{loading ? '正在同步实时热点...' : message}
		</div>
	)
}

export function NewsNowLiveSection() {
	const [expanded, setExpanded] = useState(false)
	const [sources, setSources] = useState<NewsNowSource[]>([])
	const [sourceUrl, setSourceUrl] = useState(NEWSNOW_FOCUS_URL)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (!expanded || sources.length > 0) return

		const controller = new AbortController()

		async function loadNewsNow() {
			try {
				setLoading(true)
				setError(null)
				const res = await fetch('/api/newsnow/focus', {
					headers: {
						Accept: 'application/json'
					},
					signal: controller.signal
				})
				const data = (await res.json().catch(() => ({}))) as NewsNowFocusResponse
				if (data.sourceUrl) setSourceUrl(data.sourceUrl)
				if (!res.ok) throw new Error(data.error || '实时热点加载失败')
				if (!Array.isArray(data.sources) || data.sources.length === 0) throw new Error('实时热点暂无内容')
				setSources(data.sources)
			} catch (err) {
				if (controller.signal.aborted) return
				setSources([])
				setError(err instanceof Error ? err.message : '实时热点加载失败')
			} finally {
				if (!controller.signal.aborted) setLoading(false)
			}
		}

		void loadNewsNow()

		return () => controller.abort()
	}, [expanded, sources.length])

	const featuredSources = useMemo(() => {
		const sourceMap = new Map(sources.map(source => [source.id, source]))
		return NEWSNOW_FEATURED_SOURCE_IDS.map(id => sourceMap.get(id)).filter((source): source is NewsNowSource => Boolean(source))
	}, [sources])

	const secondarySources = useMemo(() => sources.filter(source => !NEWSNOW_FEATURED_SOURCE_IDS.includes(source.id)).slice(0, 9), [sources])
	const totalItems = useMemo(() => sources.reduce((total, source) => total + source.items.length, 0), [sources])
	const latestUpdatedTime = useMemo(() => sources.reduce((latest, source) => Math.max(latest, source.updatedTime || 0), 0), [sources])

	return (
		<details
			className='news-card news-live-shell news-panel-enter relative overflow-hidden p-5 max-sm:p-4'
			onToggle={event => setExpanded(event.currentTarget.open)}>
			<NewsNowHeader expanded={expanded} muted={loading || Boolean(error)} />

			{expanded && (
				<div id='newsnow-live-content' className='news-panel-enter relative'>
					<div className='mt-4 flex justify-end'>
						<a
							href={sourceUrl}
							target='_blank'
							rel='noopener noreferrer'
							className='news-primary-action flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-transform duration-200 hover:-translate-y-0.5 max-sm:w-full max-sm:justify-center'>
							打开 NewsNow
							<ExternalLink className='size-4' />
						</a>
					</div>

					{loading ? (
						<NewsNowFallback message='正在同步实时热点...' loading />
					) : error ? (
						<NewsNowFallback message={error} />
					) : featuredSources.length === 0 ? (
						<NewsNowFallback message='实时热点暂无内容' />
					) : (
						<>
							<div className='news-live-meta relative mt-5 grid grid-cols-3 rounded-[24px] max-sm:grid-cols-1'>
								<NewsNowMetric label='焦点来源' value={sources.length} />
								<NewsNowMetric label='热点条目' value={totalItems} />
								<NewsNowMetric label='最近同步' value={formatNewsNowUpdatedTime(latestUpdatedTime)} />
							</div>

							<div className='relative mt-5 grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1'>
								{featuredSources.map((source, index) => (
									<NewsNowSourcePanel key={source.id} source={source} index={index} />
								))}
							</div>

							{secondarySources.length > 0 && (
								<div className='news-divider relative mt-5 border-t pt-4'>
									<div className='mb-3 flex items-center gap-2 text-sm font-medium'>
										<Sparkles className='size-4 text-[var(--news-accent-strong)]' />
										更多焦点源
									</div>
									<div className='flex flex-wrap gap-2'>
										{secondarySources.map(source => (
											<NewsNowSourceChip key={source.id} source={source} sourceUrl={sourceUrl} />
										))}
									</div>
								</div>
							)}
						</>
					)}
				</div>
			)}
		</details>
	)
}
