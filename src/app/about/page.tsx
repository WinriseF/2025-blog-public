'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { pageViewEndpoint } from '@/components/page-view'
import { ArrowRight } from 'lucide-react'
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
	const { data: views } = useSWR<number>(pageViewEndpoint, async (url: string) => {
		const response = await fetch(url)
		if (!response.ok) throw new Error('访问量读取失败')
		return response.json()
	})
	const [markdown, setMarkdown] = useState('')
	const [contentLoading, setContentLoading] = useState(true)
	const [contentError, setContentError] = useState(false)
	const { content, loading: markdownLoading } = useMarkdownRender(markdown, { worker: false })

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
				<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className='mb-6 text-center'>
					<h1 className='mb-4 text-4xl font-bold'>{data.title}</h1>
					<p className='text-secondary text-lg'>{data.description}</p>
					<Link
						href='/changelog'
						className='group mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[color-mix(in_srgb,var(--color-brand)_40%,var(--color-primary))] transition-colors hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand'>
						更新日志
						<ArrowRight aria-hidden='true' className='size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0' />
					</Link>
					<p className='text-secondary mt-2 min-h-5 text-sm tabular-nums'>
						{typeof views === 'number' && `全站累计访问 ${views.toLocaleString('zh-CN')} 次`}
					</p>
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
