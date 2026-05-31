'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dayjs from 'dayjs'
import { motion } from 'motion/react'
import { BlogPreview } from '@/components/blog-preview'
import { loadBlog, type LoadedBlog } from '@/lib/load-blog'
import { useReadArticles } from '@/hooks/use-read-articles'
import LiquidGrass from '@/components/liquid-grass'
import { SHOW_PUBLIC_ADMIN_ACTIONS } from '@/config/public-admin-actions'
import { ReadingProgressBar } from '@/components/reading-progress-bar'

export default function Page() {
	const { id: slug } = useParams<{ id: string }>()
	const router = useRouter()
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

	const handleEdit = () => {
		router.push(`/write/${slug}`)
	}

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

			{/* Public visitors should not see the edit entry; existing edit logic stays wired behind the flag. */}
			{SHOW_PUBLIC_ADMIN_ACTIONS && (
				<motion.button
					initial={{ opacity: 0, scale: 0.6 }}
					animate={{ opacity: 1, scale: 1 }}
					whileHover={{ scale: 1.05 }}
					whileTap={{ scale: 0.95 }}
					onClick={handleEdit}
					className='absolute top-4 right-6 rounded-xl border bg-white/60 px-6 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-white/80 max-sm:hidden'>
					编辑
				</motion.button>
			)}

			{slug === 'liquid-grass' && <LiquidGrass />}
		</>
	)
}
