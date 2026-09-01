'use client'

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { motion } from 'motion/react'
import { INIT_DELAY } from '@/consts'
import { useMarkdownRender } from '@/hooks/use-markdown-render'
import { useCodeBlockContainment } from '@/hooks/use-code-block-containment'
import { useSize } from '@/hooks/use-size'
import { BlogSidebar } from '@/components/blog-sidebar'

type BlogPreviewProps = {
	markdown: string
	title: string
	tags: string[]
	date: string
	summary?: string
	cover?: string
	slug?: string
	audioUrl?: string
}

export function BlogPreview({ markdown, title, tags, date, summary, cover, slug, audioUrl }: BlogPreviewProps) {
	const { maxSM: isMobile } = useSize()
	const { content, toc, loading } = useMarkdownRender(markdown)
	const articleRef = useRef<HTMLElement>(null)
	const copyTimersRef = useRef(new Map<HTMLButtonElement, number>())
	const [readyAudioUrl, setReadyAudioUrl] = useState('')
	useCodeBlockContainment(articleRef, content)

	useEffect(() => {
		const timers = copyTimersRef.current
		return () => {
			for (const timer of timers.values()) window.clearTimeout(timer)
			timers.clear()
		}
	}, [])

	const handleArticleClick = useCallback(async (event: MouseEvent<HTMLElement>) => {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest<HTMLButtonElement>('button[data-code-copy]')
		if (!button || !event.currentTarget.contains(button)) return

		try {
			await navigator.clipboard.writeText(button.dataset.codeCopy ?? '')
			button.dataset.copied = 'true'
			button.setAttribute('aria-label', 'Copied')

			const timers = copyTimersRef.current
			const previousTimer = timers.get(button)
			if (previousTimer) window.clearTimeout(previousTimer)
			timers.set(
				button,
				window.setTimeout(() => {
					button.removeAttribute('data-copied')
					button.setAttribute('aria-label', 'Copy code')
					timers.delete(button)
				}, 2000)
			)
		} catch (error) {
			console.error('Failed to copy code:', error)
		}
	}, [])

	if (loading) {
		return <div className='text-secondary flex h-full items-center justify-center text-sm'>渲染中...</div>
	}

	return (
		<div className='mx-auto flex max-w-[1140px] justify-center gap-6 px-6 pt-28 pb-12 max-sm:px-0'>
			<motion.article
				ref={articleRef}
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: INIT_DELAY }}
				onClick={handleArticleClick}
				className='article-card relative min-w-0 flex-1 overflow-clip rounded-xl p-8'>
				<div className='article-card-backdrop' aria-hidden='true' />
				<div className='relative z-[1]'>
					<div className='text-center text-2xl font-semibold'>{title}</div>

					<div className='text-secondary mt-4 flex flex-wrap items-center justify-center gap-3 px-8 text-center text-sm'>
						{tags.map(t => (
							<span key={t}>#{t}</span>
						))}
					</div>

					<div className='text-secondary mt-3 text-center text-sm'>{date}</div>
					{audioUrl && (
						<audio
							controls
							preload='metadata'
							src={audioUrl}
							aria-label={`${title} 音频播报`}
							onLoadedMetadata={() => setReadyAudioUrl(audioUrl)}
							onError={() => setReadyAudioUrl('')}
							className={`mx-auto mt-4 h-10 w-full max-w-md ${readyAudioUrl === audioUrl ? 'block' : 'hidden'}`}
						/>
					)}
					<div className='prose mt-6 max-w-none cursor-text'>{content}</div>
				</div>
			</motion.article>

			{!isMobile && <BlogSidebar cover={cover} summary={summary} toc={toc} slug={slug} />}
		</div>
	)
}
