import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { BlogPreview } from '@/components/blog-preview'
import { ReadingProgressBar } from '@/components/reading-progress-bar'
import { getAssetUrl } from '@/lib/asset-url'
import { getEnglishReadingArticle } from '@/lib/english-reading'

type EnglishReadingDetailPageProps = {
	params: Promise<{
		key: string
	}>
}

export default async function EnglishReadingDetailPage({ params }: EnglishReadingDetailPageProps) {
	const { key } = await params
	const result = await getEnglishReadingArticle(key)

	if (!result.ok) {
		return (
			<div className='news-page flex min-h-full items-center justify-center px-6 pt-32 pb-12'>
				<div className='news-card w-full max-w-[720px] space-y-4 p-8 text-center'>
					<h1 className='text-xl font-semibold'>英语精读</h1>
					<p className='news-muted text-sm'>{result.error}</p>
					<Link href='/news/english-reading' className='news-primary-action mx-auto flex w-fit items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium'>
						<ArrowLeft className='size-4' />
						返回英语精读
					</Link>
				</div>
			</div>
		)
	}

	const article = result.data
	return (
		<>
			<ReadingProgressBar />
			<BlogPreview
				markdown={article.markdown}
				title={article.title}
				tags={['英语', '精读', '听读']}
				date='英语精读'
				summary={article.summary}
				slug={`english-reading-${article.key}`}
				audioUrl={article.hasAudio ? getAssetUrl(`/news/english-reading/audio/${encodeURIComponent(article.key)}.mp3`) : undefined}
			/>

			<div className='news-panel-enter absolute top-4 right-6 flex gap-3 max-sm:hidden'>
				<Link href='/news/english-reading' className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/80'>
					<ArrowLeft className='size-4' />
					英语精读
				</Link>
				<a href={article.sourceUrl} target='_blank' rel='noopener noreferrer' className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/80'>
					<ExternalLink className='size-4' />
					源文件
				</a>
			</div>
		</>
	)
}
