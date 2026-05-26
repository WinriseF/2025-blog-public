import Link from 'next/link'
import { ArrowRight, CalendarDays, ExternalLink, Newspaper, PlayCircle } from 'lucide-react'
import { formatNewsDate, getNewsIndex, type NewsDay } from '@/lib/news'

export const revalidate = 300

const NEWS_PREVIEW_LIMIT = 4
const NEWS_INDEX_LIMIT = 10

function NewsState({ title, message }: { title: string; message: string }) {
	return (
		<div className='news-page flex min-h-full items-center justify-center px-6 pt-32 pb-12'>
			<div className='news-card relative w-full max-w-[720px] space-y-3 p-8 text-center'>
				<div className='news-icon mx-auto flex h-12 w-12 items-center justify-center rounded-2xl'>
					<Newspaper className='size-6' />
				</div>
				<h1 className='text-xl font-semibold'>{title}</h1>
				<p className='news-muted text-sm'>{message}</p>
			</div>
		</div>
	)
}

function NewsStat({ label, value }: { label: string; value: string | number }) {
	return (
		<div className='news-stat px-4 first:border-l-0 max-sm:border-l-0 max-sm:px-0 max-sm:py-3 max-sm:first:border-t-0'>
			<div className='news-muted text-xs'>{label}</div>
			<div className='mt-1 text-lg font-semibold leading-none max-sm:text-base'>{value}</div>
		</div>
	)
}

function NewsVideoPreview({ video }: { video: NewsDay['videos'][number] }) {
	return (
		<li className='group flex min-w-0 items-center gap-4 py-3.5 max-sm:flex-col max-sm:items-start max-sm:gap-2.5'>
			<div className='min-w-0 flex-1'>
				<div className='news-title line-clamp-2 text-sm leading-6 font-medium transition-colors'>{video.title}</div>
				<div className='news-muted mt-1 max-w-full truncate text-xs'>UP {video.up}</div>
			</div>
			<a
				href={video.url}
				target='_blank'
				rel='noopener noreferrer'
				className='news-action flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200'>
				<PlayCircle className='size-3.5' />
				视频
				<ExternalLink className='size-3' />
			</a>
		</li>
	)
}

function NewsDaySection({ day, index }: { day: NewsDay; index: number }) {
	const previewVideos = day.videos.slice(0, NEWS_PREVIEW_LIMIT)
	const hiddenCount = Math.max(day.count - previewVideos.length, 0)

	return (
		<section
			id={`day-${day.date}`}
			className='news-panel-enter news-card news-day-section scroll-mt-28 rounded-[28px] px-5 py-4 max-sm:px-4'
			style={{ animationDelay: `${120 + index * 70}ms` }}>
			<div className='news-divider flex items-start justify-between gap-4 border-b pb-4 max-sm:flex-col'>
				<Link
					href={`/news/${day.date}`}
					prefetch={false}
					className='group min-w-0'>
					<div className='news-muted text-[11px] tracking-[0.18em] uppercase'>{day.date}</div>
					<h2 className='news-heading mt-1 text-xl leading-7 font-semibold transition-colors max-sm:text-lg'>{formatNewsDate(day.date)}</h2>
				</Link>

				<Link
					href={`/news/${day.date}`}
					prefetch={false}
					className='news-action flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200'>
					{day.count} 个视频
					<ArrowRight className='size-3.5' />
				</Link>
			</div>

			{previewVideos.length > 0 ? (
				<ol className='news-list divide-y'>
					{previewVideos.map(video => (
						<NewsVideoPreview key={`${day.date}-${video.url}`} video={video} />
					))}
				</ol>
			) : (
				<div className='news-muted py-8 text-center text-sm'>暂无视频</div>
			)}

			<Link
				href={`/news/${day.date}`}
				prefetch={false}
				className='news-more mt-1 flex items-center gap-2 py-2 text-sm font-medium transition-colors max-sm:text-xs'>
				<span>{day.count > 0 ? `打开完整日报${hiddenCount > 0 ? `，还有 ${hiddenCount} 条未展示` : ''}` : '查看日报详情'}</span>
				<ArrowRight className='size-4 shrink-0' />
			</Link>
		</section>
	)
}

function NewsDateIndex({ days }: { days: NewsDay[] }) {
	const visibleDays = days.slice(0, NEWS_INDEX_LIMIT)
	const remainingCount = Math.max(days.length - visibleDays.length, 0)

	return (
		<aside className='news-panel-enter sticky top-24 h-fit max-lg:static'>
			<div className='news-card relative space-y-4 rounded-[28px] p-4'>
				<div className='flex items-center gap-2'>
					<div className='news-icon flex h-9 w-9 items-center justify-center rounded-2xl'>
						<CalendarDays className='size-4' />
					</div>
					<div>
						<div className='text-sm font-semibold'>日期索引</div>
						<div className='news-muted text-xs'>最近 {visibleDays.length} 天</div>
					</div>
				</div>

				<nav className='space-y-1'>
					{visibleDays.map(day => (
						<a
							key={day.date}
							href={`#day-${day.date}`}
							className='news-index-link group flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-xs transition-colors duration-200'>
							<span className='font-medium'>{day.date.slice(5)}</span>
							<span className='news-muted'>{day.count}</span>
						</a>
					))}
				</nav>

				{remainingCount > 0 && <div className='news-divider news-muted border-t pt-3 text-xs'>下方还有 {remainingCount} 天日报</div>}
			</div>
		</aside>
	)
}

export default async function NewsPage() {
	const result = await getNewsIndex()

	if (!result.ok) {
		return <NewsState title='新闻趋势' message={result.error} />
	}

	const { title, updatedAt, days } = result.data
	const latestDay = days[0]
	const totalVideos = days.reduce((total, day) => total + day.count, 0)

	if (days.length === 0) {
		return <NewsState title={title} message='暂无新闻趋势内容' />
	}

	return (
		<div className='news-page mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 pt-32 pb-12 max-sm:px-4 max-sm:pt-24'>
			<section className='news-card news-panel-enter relative w-full overflow-hidden p-6 max-sm:p-5'>
				<div className='grid grid-cols-[minmax(0,1fr)_auto] gap-8 max-sm:grid-cols-1 max-sm:gap-5'>
					<div className='flex min-w-0 items-center gap-4'>
						<div className='news-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl'>
							<Newspaper className='size-7' />
						</div>
						<div className='min-w-0'>
							<div className='news-muted text-xs tracking-[0.22em] uppercase'>Daily Video Digest</div>
							<h1 className='mt-1 truncate text-2xl font-semibold max-sm:text-xl'>{title}</h1>
							<p className='news-muted mt-2 text-sm'>{updatedAt ? `更新时间：${updatedAt}` : '按日期整理的新闻趋势内容'}</p>
						</div>
					</div>

					{latestDay && (
						<Link href={`/news/${latestDay.date}`} prefetch={false} className='news-primary-action flex h-fit shrink-0 items-center gap-2 self-center rounded-xl px-4 py-2 text-sm font-medium transition-transform duration-200 hover:-translate-y-0.5 max-sm:w-full max-sm:justify-center'>
							查看最新
							<ArrowRight className='size-4' />
						</Link>
					)}
				</div>

				<div className='news-stat-panel mt-6 grid grid-cols-3 rounded-2xl py-4 max-sm:grid-cols-1 max-sm:px-4 max-sm:py-0'>
					<NewsStat label='收录天数' value={days.length} />
					<NewsStat label='视频总数' value={totalVideos} />
					<NewsStat label='最新日期' value={latestDay?.date || '-'} />
				</div>
			</section>

			<div className='grid grid-cols-[220px_minmax(0,1fr)] gap-6 max-lg:grid-cols-1'>
				<NewsDateIndex days={days} />
				<div className='space-y-4'>
					{days.map((day, index) => (
						<NewsDaySection key={day.date} day={day} index={index} />
					))}
				</div>
			</div>
		</div>
	)
}
