import Link from 'next/link'
import { CalendarDays, ExternalLink, Newspaper, PlayCircle } from 'lucide-react'
import { getEnglishReadingIndex } from '@/lib/english-reading'
import { formatNewsDate, getNewsIndex, type NewsDay } from '@/lib/news'
import { NewsEntryDeck } from './news-entry-deck'
import { NewsNowLiveSection } from './newsnow-live-section'

export const revalidate = 300

const NEWS_PREVIEW_LIMIT = 4
const NEWS_INDEX_LIMIT = 10
const NEWS_PAGE_SIZE = 30
const ENTER_ANIMATION_LIMIT = 6

type NewsPageProps = {
	searchParams: Promise<{
		page?: string | string[]
	}>
}

function parsePage(value?: string | string[]) {
	const page = Number(Array.isArray(value) ? value[0] : value)
	return Number.isInteger(page) && page > 0 ? page : 1
}

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

	return (
		<section
			id={`day-${day.date}`}
			className='news-panel-enter news-card news-day-section scroll-mt-28 rounded-[28px] px-5 py-4 max-sm:px-4'
			style={{ animationDelay: `${120 + Math.min(index, ENTER_ANIMATION_LIMIT) * 70}ms` }}>
			<div className='news-divider flex items-start justify-between gap-4 border-b pb-4 max-sm:flex-col'>
				<Link
					href={`/news/${day.date}`}
					prefetch={false}
					className='group min-w-0'>
					<h2 className='news-heading mt-1 text-xl leading-7 font-semibold transition-colors max-sm:text-lg'>{formatNewsDate(day.date)}</h2>
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
		</section>
	)
}

function NewsDateIndex({ days, currentPage, totalPages }: { days: NewsDay[]; currentPage: number; totalPages: number }) {
	const visibleDays = days.slice(0, NEWS_INDEX_LIMIT)

	return (
		<aside className='news-panel-enter sticky top-24 h-fit max-lg:static'>
			<div className='news-card relative space-y-4 rounded-[28px] p-4'>
				<div className='flex items-center gap-2'>
					<div className='news-icon flex h-9 w-9 items-center justify-center rounded-2xl'>
						<CalendarDays className='size-4' />
					</div>
					<div>
						<div className='text-sm font-semibold'>日期索引</div>
						<div className='news-muted text-xs'>第 {currentPage}/{totalPages} 页 · 本页 {days.length} 天</div>
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

				{days.length > visibleDays.length && <div className='news-divider news-muted border-t pt-3 text-xs'>下方还有 {days.length - visibleDays.length} 天日报</div>}
			</div>
		</aside>
	)
}

function NewsPagination({ currentPage, totalPages }: { currentPage: number; totalPages: number }) {
	if (totalPages <= 1) return null

	return (
		<nav aria-label='新闻分页' className='news-panel-enter flex items-center justify-center gap-3'>
			{currentPage > 1 && (
				<Link href={currentPage === 2 ? '/news' : `/news?page=${currentPage - 1}`} className='news-card rounded-full px-4 py-2 text-sm font-medium'>
					上一页
				</Link>
			)}
			<span className='news-muted text-sm'>第 {currentPage} / {totalPages} 页</span>
			{currentPage < totalPages && (
				<Link href={`/news?page=${currentPage + 1}`} className='news-card rounded-full px-4 py-2 text-sm font-medium'>
					下一页
				</Link>
			)}
		</nav>
	)
}

export default async function NewsPage({ searchParams }: NewsPageProps) {
	const [result, englishReadingResult, params] = await Promise.all([getNewsIndex(), getEnglishReadingIndex(), searchParams])

	if (!result.ok) {
		return <NewsState title='每日内容与热点' message={result.error} />
	}

	const { title, updatedAt, days } = result.data
	const latestDay = days[0]
	const totalVideos = days.reduce((total, day) => total + day.count, 0)

	if (days.length === 0) {
		return <NewsState title={title} message='暂无日报内容' />
	}

	const totalPages = Math.ceil(days.length / NEWS_PAGE_SIZE)
	const currentPage = Math.min(parsePage(params.page), totalPages)
	const pageStart = (currentPage - 1) * NEWS_PAGE_SIZE
	const visibleDays = days.slice(pageStart, pageStart + NEWS_PAGE_SIZE)

	return (
		<div className='news-page mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 pt-32 pb-12 max-sm:px-4 max-sm:pt-24'>
			<NewsEntryDeck
				daily={{
					title,
					updatedAt,
					latestHref: `/news/${latestDay.date}`,
					dayCount: days.length,
					videoCount: totalVideos,
					latestDate: latestDay.date
				}}
				englishReading={englishReadingResult.ok ? englishReadingResult.data.items[0] : undefined}
			/>

			<NewsNowLiveSection />

			<div className='grid grid-cols-[220px_minmax(0,1fr)] gap-6 max-lg:grid-cols-1'>
				<NewsDateIndex days={visibleDays} currentPage={currentPage} totalPages={totalPages} />
				<div className='space-y-4'>
					{visibleDays.map((day, index) => (
						<NewsDaySection key={day.date} day={day} index={index} />
					))}
				</div>
			</div>

			<NewsPagination currentPage={currentPage} totalPages={totalPages} />
		</div>
	)
}
