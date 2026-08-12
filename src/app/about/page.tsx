'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useMarkdownRender } from '@/hooks/use-markdown-render'
import LikeButton from '@/components/like-button'
import GithubSVG from '@/svgs/github.svg'
import initialData from './list.json'

type AboutData = {
	title: string
	description: string
}

export default function Page() {
	const data = initialData as AboutData
	const [markdown, setMarkdown] = useState('')
	const [contentLoading, setContentLoading] = useState(true)
	const [contentError, setContentError] = useState(false)
	const { content, loading: markdownLoading } = useMarkdownRender(markdown)

	useEffect(() => {
		let cancelled = false

		fetch('/about.md')
			.then(response => {
				if (!response.ok) throw new Error(`About content request failed: ${response.status}`)
				return response.text()
			})
			.then(value => {
				if (!cancelled) setMarkdown(value)
			})
			.catch(error => {
				console.error('About content load error:', error)
				if (!cancelled) setContentError(true)
			})
			.finally(() => {
				if (!cancelled) setContentLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [])

	const loading = contentLoading || markdownLoading

	return (
		<div className='flex flex-col items-center justify-center px-6 pt-32 pb-12 max-sm:px-0'>
			<div className='w-full max-w-[800px]'>
				<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className='mb-12 text-center'>
					<h1 className='mb-4 text-4xl font-bold'>{data.title}</h1>
					<p className='text-secondary text-lg'>{data.description}</p>
				</motion.div>

				{loading ? (
					<div className='text-secondary text-center'>加载中...</div>
				) : contentError ? (
					<div className='text-secondary text-center'>内容加载失败，请稍后再试。</div>
				) : (
					<motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className='card relative p-6'>
						<div className='prose prose-sm max-w-none'>{content}</div>
					</motion.div>
				)}

				<div className='mt-8 flex items-center justify-center gap-6'>
					<motion.a
						href='https://github.com/WinriseF/2025-blog-public'
						target='_blank'
						rel='noreferrer'
						initial={{ opacity: 0, scale: 0.6 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ delay: 0 }}
						className='flex h-[53px] w-[53px] items-center justify-center rounded-full border bg-card'>
						<GithubSVG />
					</motion.a>

					<LikeButton slug='open-source' delay={0} />
				</div>
			</div>
		</div>
	)
}
