'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dayjs from 'dayjs'
import { BlogPreview } from '@/components/blog-preview'
import { loadBlog, type LoadedBlog } from '@/lib/load-blog'
import { useReadArticles } from '@/hooks/use-read-articles'
import { ReadingProgressBar } from '@/components/reading-progress-bar'

export default function Page() {
	const { id: slug } = useParams<{ id: string }>()
	const { markAsRead } = useReadArticles()

	const [blog, setBlog] = useState<LoadedBlog | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState<boolean>(true)

	useEffect(() => {
		let cancelled = false
		async function run() {
			try {
				setLoading(true)
				const blogData = await loadBlog(slug)

				if (!cancelled) {
					setBlog(blogData)
					setError(null)
					markAsRead(slug)
				}
			} catch (error) {
				if (!cancelled) setError(error instanceof Error ? error.message : '加载失败')
			} finally {
				if (!cancelled) setLoading(false)
			}
		}
		run()
		return () => {
			cancelled = true
		}
	}, [slug, markAsRead])

	if (loading) {
		return <div className='text-secondary flex h-full items-center justify-center text-sm'>加载中...</div>
	}

	if (error) {
		return <div className='flex h-full items-center justify-center text-sm text-red-500'>{error}</div>
	}

	if (!blog) {
		return <div className='text-secondary flex h-full items-center justify-center text-sm'>文章不存在</div>
	}

	const { title, tags, summary } = blog.config
	const date = dayjs(blog.config.date).format('YYYY年 M月 D日')

	return (
		<>
			<ReadingProgressBar />
			<BlogPreview
				markdown={blog.markdown}
				title={title}
				tags={tags}
				date={date}
				summary={summary}
				cover={blog.cover}
				slug={slug}
			/>
		</>
	)
}
