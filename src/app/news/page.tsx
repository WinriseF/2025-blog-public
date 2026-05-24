import Link from 'next/link'
import { ArrowRight, CalendarDays, ExternalLink, Newspaper, PlayCircle } from 'lucide-react'
import { formatNewsDate, getNewsIndex, type NewsDay } from '@/lib/news'

export const revalidate = 300

function NewsState({ title, message }: { title: string; message: string }) {
	return (
		<div className='flex min-h-full items-center justify-center px-6 pt-32 pb-12'>
			<div className='card relative w-full max-w-[720px] space-y-3 p-8 text-center'>
				<div className='mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border bg-white/45'>
					<Newspaper className='text-brand size-6' />
				</div>
				<h1 className='text-xl font-semibold'>{title}</h1>
				<p className='text-secondary text-sm'>{message}</p>
			</div>
		</div>
	)
}

function NewsDaySection({ day, index }: { day: NewsDay; index: number }) {
	return (
		<section className='card news-panel-enter news-day-section relative w-full max-w-[920px] space-y-4 p-5' style={{ animationDelay: `${120 + index * 70}ms` }}>
			<div className='flex flex-wrap items-start justify-between gap-3'>
				<Link href={`/news/${day.date}`} prefetch={false} className='group flex items-center gap-3'>
					<div className='bg-brand/10 text-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-transform duration-300 group-hover:scale-105'>
						<CalendarDays className='size-5' />
					</div>
					<div>
						<h2 className='group-hover:text-brand text-base font-semibold transition-colors'>{formatNewsDate(day.date)}</h2>
						<p className='text-secondary mt-1 text-xs'>{day.count} 个视频</p>
					</div>
				</Link>

				<Link
					href={`/news/${day.date}`}
					prefetch={false}
					className='text-brand flex items-center gap-1 rounded-xl border bg-white/45 px-3 py-2 text-xs font-medium transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/70'>
					查看日报
					<ArrowRight className='size-3.5' />
				</Link>
			</div>

			{day.videos.length > 0 ? (
				<div className='overflow-hidden rounded-2xl border bg-white/35'>
					{day.videos.map(video => (
						<div
							key={`${day.date}-${video.url}`}
							className='group grid grid-cols-[minmax(96px,128px)_1fr_auto] items-center gap-4 border-b px-4 py-3 transition-colors duration-200 last:border-b-0 hover:bg-white/45 max-sm:grid-cols-1 max-sm:gap-2'>
							<div className='text-secondary truncate text-xs'>UP：{video.up}</div>
							<div className='line-clamp-2 text-sm font-medium transition-transform duration-200 group-hover:translate-x-1'>{video.title}</div>
							<a
								href={video.url}
								target='_blank'
								rel='noopener noreferrer'
								className='text-brand flex w-fit items-center gap-1 rounded-lg border bg-white/45 px-3 py-1.5 text-xs font-medium transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/80'>
								<PlayCircle className='size-3.5' />
								视频
								<ExternalLink className='size-3' />
							</a>
						</div>
					))}
				</div>
			) : (
				<div className='text-secondary rounded-2xl border bg-white/35 px-4 py-8 text-center text-sm'>暂无视频</div>
			)}
		</section>
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
		<div className='flex flex-col items-center justify-center gap-6 px-6 pt-32 pb-12'>
			<section className='card news-panel-enter relative w-full max-w-[920px] overflow-hidden p-6'>
				<div className='flex flex-wrap items-center justify-between gap-5'>
					<div className='flex items-center gap-4'>
						<div className='bg-brand/10 text-brand flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border'>
							<Newspaper className='size-7' />
						</div>
						<div>
							<h1 className='text-2xl font-semibold'>{title}</h1>
							<p className='text-secondary mt-2 text-sm'>
								{updatedAt ? `更新时间：${updatedAt}` : '按日期整理的新闻趋势内容'} · {days.length} 天 · {totalVideos} 个视频
							</p>
						</div>
					</div>

					{latestDay && (
						<Link href={`/news/${latestDay.date}`} prefetch={false} className='brand-btn shrink-0 transition-transform duration-200 hover:-translate-y-0.5'>
							查看最新
							<ArrowRight className='size-4' />
						</Link>
					)}
				</div>
			</section>

			{days.map((day, index) => (
				<NewsDaySection key={day.date} day={day} index={index} />
			))}
		</div>
	)
}
