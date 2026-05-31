'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { BlogPreview } from '@/components/blog-preview'
import { ReadingProgressBar } from '@/components/reading-progress-bar'

type NewsArticle = {
	date: string
	title: string
	markdown: string
	sourceUrl: string
	tags: string[]
	summary: string
}

const NEWS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidNewsDate(date: string): boolean {
	if (!NEWS_DATE_RE.test(date)) return false

	const [year, month, day] = date.split('-').map(Number)
	const parsed = new Date(Date.UTC(year, month - 1, day))

	return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function formatNewsDate(date: string): string {
	if (!isValidNewsDate(date)) return date
	const [year, month, day] = date.split('-')
	return `${year}年 ${Number(month)}月 ${Number(day)}日`
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

export default function NewsDetailPage() {
	const { date } = useParams<{ date: string }>()
	const [article, setArticle] = useState<NewsArticle | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let cancelled = false

		async function run() {
			if (!isValidNewsDate(date)) {
				setArticle(null)
				setError('请使用 YYYY-MM-DD 格式访问新闻日报。')
				setLoading(false)
				return
			}

			try {
				setLoading(true)
				setError(null)
				const res = await fetch(`/api/news/${encodeURIComponent(date)}`)
				const data = await res.json().catch(() => ({}))

				if (!res.ok) {
					throw new Error(data?.error || '新闻数据加载失败')
				}

				if (!cancelled) {
					setArticle(data as NewsArticle)
				}
			} catch (error) {
				if (!cancelled) {
					setArticle(null)
					setError(error instanceof Error ? error.message : '新闻数据加载失败')
				}
			} finally {
				if (!cancelled) {
					setLoading(false)
				}
			}
		}

		void run()

		return () => {
			cancelled = true
		}
	}, [date])

	const displayDate = useMemo(() => formatNewsDate(date), [date])

	if (loading) {
		return <div className='text-secondary flex h-full items-center justify-center text-sm'>加载中...</div>
	}

	if (error) {
		const title = isValidNewsDate(date) ? displayDate : '新闻日期无效'
		return <NewsDetailState title={title} message={error} />
	}

	if (!article) {
		return <NewsDetailState title={displayDate} message='新闻日报不存在。' />
	}

	return (
		<>
			<ReadingProgressBar />
			<BlogPreview
				markdown={article.markdown}
				title={article.title}
				tags={article.tags}
				date={formatNewsDate(article.date)}
				summary={article.summary}
				slug={`news-${article.date}`}
			/>

			<div className='news-panel-enter absolute top-4 right-6 flex gap-3 max-sm:hidden'>
				<Link
					href='/news'
					className='flex items-center gap-2 rounded-xl border bg-white/60 px-4 py-2 text-sm backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/80'>
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
