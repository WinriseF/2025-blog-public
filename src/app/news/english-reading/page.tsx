import Link from 'next/link'
import { ArrowRight, BookOpenText, Headphones } from 'lucide-react'
import { getEnglishReadingIndex } from '@/lib/english-reading'

export const revalidate = 300

export default async function EnglishReadingPage() {
	const result = await getEnglishReadingIndex()

	if (!result.ok) {
		return (
			<div className='news-page flex min-h-full items-center justify-center px-6 pt-32 pb-12'>
				<div className='news-card w-full max-w-[720px] space-y-3 p-8 text-center'>
					<h1 className='text-xl font-semibold'>英语精读</h1>
					<p className='news-muted text-sm'>{result.error}</p>
				</div>
			</div>
		)
	}

	return (
		<div className='news-page mx-auto flex w-full max-w-[920px] flex-col gap-5 px-6 pt-32 pb-12 max-sm:px-4 max-sm:pt-24'>
			<section className='news-card news-panel-enter relative overflow-hidden p-6 max-sm:p-5'>
				<div className='flex items-start gap-4'>
					<div className='news-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl'>
						<BookOpenText className='size-7' />
					</div>
					<div>
						<div className='news-muted text-xs tracking-[0.22em] uppercase'>English Reading</div>
						<h1 className='mt-1 text-2xl font-semibold max-sm:text-xl'>英语精读</h1>
						<p className='news-muted mt-2 text-sm leading-6'>每天一篇英文原文，配合音频进行听读。</p>
					</div>
				</div>
			</section>

			{result.data.items.length > 0 ? (
				<div className='space-y-3'>
					{result.data.items.map((item, index) => (
						<Link
							key={item.key}
							href={`/news/english-reading/${encodeURIComponent(item.key)}`}
							prefetch={false}
							className='news-card news-panel-enter group flex min-h-28 items-center gap-4 rounded-[28px] p-5 transition-transform duration-200 hover:-translate-y-0.5 max-sm:items-start max-sm:p-4'
							style={{ animationDelay: `${120 + index * 55}ms` }}>
							<div className='news-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl'>
								{item.hasAudio ? <Headphones className='size-5' /> : <BookOpenText className='size-5' />}
							</div>
							<div className='min-w-0 flex-1'>
								<div className='news-muted text-xs'>英文原文精读 {item.hasAudio ? '· 含音频' : ''}</div>
								<h2 className='news-heading mt-1 text-lg leading-6 font-semibold transition-colors'>{item.title}</h2>
							</div>
							<ArrowRight className='news-muted size-5 shrink-0 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-[var(--news-accent-strong)]' />
						</Link>
					))}
				</div>
			) : (
				<div className='news-card news-muted rounded-[28px] p-8 text-center text-sm'>暂无英语精读内容</div>
			)}
		</div>
	)
}
