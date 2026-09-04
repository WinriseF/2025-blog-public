import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { BlogPreview } from '@/components/blog-preview'
import { getAssetUrl } from '@/lib/asset-url'
import { formatNewsDate, getNewsArticle, isValidNewsDate } from '@/lib/news'

type NewsDetailPageProps = {
	params: Promise<{
		date: string
	}>
}

function NewsDetailState({ title, message }: { title: string; message: string }) {
	return (
		<div className='flex min-h-full items-center justify-center px-6 pt-32 pb-12'>
			<div className='card news-panel-enter relative w-full max-w-[720px] space-y-4 p-8 text-center'>
				<h1 className='text-xl font-semibold'>{title}</h1>
				<p className='text-secondary text-sm'>{message}</p>
				<Link href='/news' className='brand-btn mx-auto w-fit transition-transform duration-200 hover:-translate-y-0.5'>
					<ArrowLeft className='size-4' />
					返回新闻列表
				</Link>
			</div>
		</div>
	)
}

export default async function NewsDetailPage({ params }: NewsDetailPageProps) {
	const { date } = await params
	const displayDate = formatNewsDate(date)
	const result = await getNewsArticle(date)

	if (!result.ok) {
		return <NewsDetailState title={isValidNewsDate(date) ? displayDate : '新闻日期无效'} message={result.error} />
	}

	const article = result.data
	return (
		<>
			<BlogPreview
				markdown={article.markdown}
				title={article.title}
				tags={article.tags}
				date={formatNewsDate(article.date)}
				summary={article.summary}
				slug={`news-${article.date}`}
				audioUrl={getAssetUrl(`/news/bili/audio/${article.date}.mp3`)}
			/>

			<div className='news-panel-enter absolute top-4 right-6 flex gap-3 max-sm:hidden'>
				<Link href='/news' className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/80'>
					<ArrowLeft className='size-4' />
					新闻列表
				</Link>
				<a
					href={article.sourceUrl}
					target='_blank'
					rel='noopener noreferrer'
					className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/80'>
					<ExternalLink className='size-4' />
					源文件
				</a>
			</div>
		</>
	)
}
